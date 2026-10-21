import {
  API,
  API_VERSION,
  DraftSchema,
  ErrorBodySchema,
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

export type ClientOptions = { baseUrl: string; devUser?: string; fetch?: typeof fetch };

type SubscribeOpts = { onStatus?: (s: SseStatus) => void };

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
      res = await doFetch(urlFor(path), { method, headers: h, body: init.body });
    } catch {
      throw new DeviApiError(0, {
        error: `No se pudo conectar con el servidor de Devi (${base}). ¿Está encendido y estás en la tailnet?`,
        code: "unreachable",
      });
    }
    if (!res.ok) throw new DeviApiError(res.status, await errorBody(res));
    return res;
  }

  async function parsed<S extends z.ZodType>(res: Response, schema: S): Promise<z.infer<S>> {
    if (schema instanceof z.ZodAny) return (await raw(res)) as z.infer<S>;
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

  return {
    async call(name, callOpts = {}) {
      const route = API[name];
      const path = buildPath(route.path, callOpts.params ?? {});
      const hasBody = route.method === "POST" || route.method === "PATCH";
      const res = await send(route.method, path, hasBody ? { body: JSON.stringify(callOpts.body ?? {}), json: true } : {});
      return parsed(res, route.response);
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
      return subscribeSse({
        url: sseUrlFor(API.userEvents.path),
        headers: headers(),
        fetch: doFetch,
        onStatus: subOpts.onStatus,
        onFrame: (f) => {
          const e = safeJson(f.data, UserEventSchema);
          if (e && e.type === f.event) onEvent(e);
        },
      });
    },

    subscribeSession(sessionId, onDelivery, subOpts = {}) {
      return subscribeSse({
        url: sseUrlFor(buildPath(API.sessionEvents.path, { id: sessionId })),
        headers: headers(),
        fetch: doFetch,
        onStatus: subOpts.onStatus,
        onFrame: (f) => {
          if (f.event !== SESSION_EVENT) return;
          const d = safeJson(f.data, SessionDeliverySchema);
          if (d) onDelivery(d);
        },
      });
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
