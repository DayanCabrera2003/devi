import {
  API,
  API_VERSION,
  DraftSchema,
  ErrorBodySchema,
  PRESENCE,
  SESSION_EVENT,
  SessionDeliverySchema,
  UserEventSchema,
  VERSION_HEADER,
  VERSION_QUERY,
  buildPath,
  type ApiRoute,
  type CreateDraftMeta,
  type Draft,
  type ErrorBody,
  type SessionDelivery,
  type UserEvent,
} from "@devi/protocol";
import { z } from "zod";
import { DeviApiError } from "./errors";
import { subscribeSse, type FetchFn, type SseStatus } from "./sse";

// requestTimeoutMs: opción interna (por defecto 15 s) para call, createDraft y downloadFile; los SSE no la usan.
export type ClientOptions = { baseUrl: string; devUser?: string; fetch?: typeof fetch; requestTimeoutMs?: number;
  // Opción interna (por defecto PRESENCE.heartbeatMs) para los tests: cada cuánto se manda el heartbeat de presencia.
  heartbeatMs?: number;
};

// Rutas cuya respuesta no es JSON validable (z.any()): bytes, texto o SSE. Se listan por nombre
// porque `instanceof z.ZodAny` no es fiable en zod 4 (los esquemas ya no son instancias de esa clase).
const RAW_ROUTES: ReadonlySet<ApiRoute> = new Set<ApiRoute>(["exportDb", "downloadFile", "userEvents", "sessionEvents"]);

type SubscribeOpts = { onStatus?: (s: SseStatus, err?: DeviApiError) => void };

export interface DeviClient {
  call<R extends ApiRoute>(
    name: R,
    opts?: { params?: Record<string, string>; body?: unknown },
  ): Promise<z.infer<(typeof API)[R]["response"]>>;
  createDraft(meta: z.infer<typeof CreateDraftMeta>, files: { name: string; content: string }[]): Promise<Draft>;
  downloadFile(id: string): Promise<string>;
  subscribeUser(onEvent: (e: UserEvent) => void, opts?: SubscribeOpts): () => void;
  subscribeSession(sessionId: string, onDelivery: (d: SessionDelivery) => void, opts?: SubscribeOpts): () => void;
}

export function createClient(opts: ClientOptions): DeviClient {
  const base = opts.baseUrl.replace(/\/+$/, "");
  const doFetch: FetchFn = opts.fetch ?? ((url, init) => fetch(url, init));

  const headers = (): Record<string, string> => {
    const h: Record<string, string> = { [VERSION_HEADER]: API_VERSION };
    if (opts.devUser) h["X-Devi-Dev-User"] = opts.devUser;
    return h;
  };
  const heartbeatMs = opts.heartbeatMs ?? PRESENCE.heartbeatMs;
  const timeoutMs = opts.requestTimeoutMs ?? 15_000;
  const urlFor = (path: string) => `${base}${path}`;
  // Los SSE llevan además versión y usuario de dev en la query (el servidor solo la mira en /events/*).
  const sseUrlFor = (path: string) => {
    const q = new URLSearchParams({ [VERSION_QUERY]: API_VERSION });
    if (opts.devUser) q.set("devUser", opts.devUser);
    return `${base}${path}?${q}`;
  };

  async function send(method: string, path: string, init: { body?: RequestInit["body"]; json?: boolean } = {}): Promise<Response> {
    const h = headers();
    if (init.json) h["Content-Type"] = "application/json";
    let res: Response;
    try {
      res = await doFetch(urlFor(path), { method, headers: h, body: init.body, signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      if (e instanceof Error && e.name === "TimeoutError") {
        throw new DeviApiError(0, {
          error: `El servidor de Devi no respondió a tiempo (${base}). Inténtalo de nuevo en unos segundos.`,
          code: "unreachable",
        });
      }
      throw new DeviApiError(0, {
        error: `No se pudo conectar con el servidor de Devi (${base}). ¿Está encendido y estás en la tailnet?`,
        code: "unreachable",
      });
    }
    if (!res.ok) throw new DeviApiError(res.status, await errorBody(res));
    return res;
  }

  async function parsed<S extends z.ZodType>(res: Response, schema: S, isRaw = false): Promise<z.infer<S>> {
    if (isRaw) return (await raw(res)) as z.infer<S>;
    const data: unknown = await res.json().catch(() => undefined);
    const r = schema.safeParse(data);
    if (!r.success) {
      throw new DeviApiError(res.status, {
        error: "Respuesta inesperada del servidor de Devi (¿versiones distintas?)",
        code: "bad_response",
      });
    }
    return r.data;
  }

  // Presencia: mientras haya una suscripción, un heartbeat al conectar y cada heartbeatMs.
  // Los errores se ignoran: nunca deben romper el stream.
  function startHeartbeats(body: { sessionId?: string }) {
    let timer: ReturnType<typeof setInterval> | null = null;
    let stopped = false;
    const beat = () => {
      if (stopped) return;
      send(API.heartbeat.method, API.heartbeat.path, { body: JSON.stringify(body), json: true }).then(
        (res) => void res.body?.cancel().catch(() => {}),
        () => {},
      );
    };
    timer = setInterval(beat, heartbeatMs);
    return {
      beat,
      stop() {
        stopped = true;
        if (timer) clearInterval(timer);
        timer = null;
      },
    };
  }

  return {
    async call(name, callOpts = {}) {
      const route = API[name];
      const path = buildPath(route.path, callOpts.params ?? {});
      const hasBody = route.method === "POST" || route.method === "PATCH";
      const res = await send(route.method, path, hasBody ? { body: JSON.stringify(callOpts.body ?? {}), json: true } : {});
      return parsed(res, route.response, RAW_ROUTES.has(name));
    },

    async createDraft(meta, files) {
      const form = new FormData();
      form.append("meta", JSON.stringify(meta));
      for (const f of files) form.append("files", new File([f.content], f.name, { type: "text/plain;charset=utf-8" }));
      const res = await send(API.createDraft.method, API.createDraft.path, { body: form });
      return parsed(res, DraftSchema);
    },

    async downloadFile(id) {
      const res = await send(API.downloadFile.method, buildPath(API.downloadFile.path, { id }));
      return res.text();
    },

    subscribeUser(onEvent, subOpts = {}) {
      const hb = startHeartbeats({});
      const stopSse = subscribeSse({
        url: sseUrlFor(API.userEvents.path),
        headers: headers(),
        fetch: doFetch,
        onStatus: (s, err) => {
          if (s === "open") hb.beat();
          if (s === "failed") hb.stop();
          subOpts.onStatus?.(s, err);
        },
        onFrame: (f) => {
          const e = safeJson(f.data, UserEventSchema);
          if (e && e.type === f.event) onEvent(e);
        },
      });
      return () => {
        hb.stop();
        stopSse();
      };
    },

    subscribeSession(sessionId, onDelivery, subOpts = {}) {
      const hb = startHeartbeats({ sessionId });
      const stopSse = subscribeSse({
        url: sseUrlFor(buildPath(API.sessionEvents.path, { id: sessionId })),
        headers: headers(),
        fetch: doFetch,
        onStatus: (s, err) => {
          if (s === "open") hb.beat();
          if (s === "failed") hb.stop();
          subOpts.onStatus?.(s, err);
        },
        onFrame: (f) => {
          if (f.event !== SESSION_EVENT) return;
          const d = safeJson(f.data, SessionDeliverySchema);
          if (d) onDelivery(d);
        },
      });
      return () => {
        hb.stop();
        stopSse();
      };
    },
  };
}

async function errorBody(res: Response): Promise<ErrorBody> {
  const data: unknown = await res.json().catch(() => undefined);
  const r = ErrorBodySchema.safeParse(data);
  return r.success ? r.data : { error: `El servidor de Devi respondió ${res.status}` };
}

// Rutas con respuesta z.any(): JSON sin validar, texto, o bytes (exportar la base de datos).
async function raw(res: Response): Promise<unknown> {
  const type = res.headers.get("Content-Type") ?? "";
  if (type.includes("application/json")) return res.json();
  if (type.startsWith("text/")) return res.text();
  return res.arrayBuffer();
}

function safeJson<S extends z.ZodType>(text: string, schema: S): z.infer<S> | null {
  try {
    const r = schema.safeParse(JSON.parse(text));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}
