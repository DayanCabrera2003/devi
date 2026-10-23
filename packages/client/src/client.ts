import {
  API,
  ChatMessageSchema,
  ChatPageSchema,
  type ChatFromSessionMeta,
  API_VERSION,
  CreateDraftResult,
  ConversationPageSchema,
  ConversationsResponseSchema,
  DeviRequestSchema,
  ErrorBodySchema,
  InboxItemSchema,
  PRESENCE,
  SESSION_EVENT,
  SessionDeliverySchema,
  UserEventSchema,
  VERSION_HEADER,
  VERSION_QUERY,
  buildPath,
  type ApiRoute,
  type ChatMessage,
  type ChatPage,
  type ConversationPage,
  type ConversationsResponse,
  type CreateDraftMeta,
  type DeviRequest,
  type ErrorBody,
  type InboxItem,
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
  // Opción interna SOLO para tests en Bun: manda la cabecera Origin como la manda el navegador de la app
  // (en el webview la pone el propio navegador). La CLI y el MCP nunca la usan.
  origin?: string;
  // Entregas que esta versión no entiende (un kind nuevo de un servidor más nuevo): se saltan sin romper el resto
  // de la bandeja o del stream, y se avisa por aquí (el MCP y el hook lo apuntan en su log).
  onIgnored?: (message: string) => void;
};

// Rutas cuya respuesta no es JSON validable (z.any()): bytes, texto o SSE. Se listan por nombre
// porque `instanceof z.ZodAny` no es fiable en zod 4 (los esquemas ya no son instancias de esa clase).
const RAW_ROUTES: ReadonlySet<ApiRoute> = new Set<ApiRoute>(["exportDb", "downloadFile", "userEvents", "sessionEvents"]);

type SubscribeOpts = { onStatus?: (s: SseStatus, err?: DeviApiError) => void };

export interface DeviClient {
  call<R extends ApiRoute>(
    name: R,
    opts?: { params?: Record<string, string>; body?: unknown; query?: Record<string, string> },
  ): Promise<z.infer<(typeof API)[R]["response"]>>;
  // meta.approval es opcional ("app" por defecto); el resultado dice cómo se aprobó y, si ya salió, a quién.
  createDraft(meta: z.input<typeof CreateDraftMeta>, files: { name: string; content: string }[]): Promise<CreateDraftResult>;
  // Solicitud escrita por la persona en la app (POST /requests, multipart). En el webview el navegador
  // pone el Origin de la app, que la ruta exige.
  sendFromApp(meta: { to: string; message: string }, files: { name: string; content: string }[]): Promise<DeviRequest>;
  // Mensaje de chat escrito en la app (POST /chat, multipart; exige el Origin de la app, como sendFromApp).
  sendChat(meta: { to: string; text: string }, files: { name: string; content: string }[]): Promise<ChatMessage>;
  // Mensaje de chat escrito por Claude (reply_in_chat): solo sale con approval "chat" (ver ChatFromSessionMeta).
  chatFromSession(meta: z.input<typeof ChatFromSessionMeta>, files: { name: string; content: string }[]): Promise<ChatMessage>;
  chat(memberId: string, opts?: { before?: number; limit?: number }): Promise<ChatPage>;
  conversations(): Promise<ConversationsResponse>;
  conversation(memberId: string, opts?: { before?: number; limit?: number }): Promise<ConversationPage>;
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
    if (opts.origin) h.Origin = opts.origin;
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

  const ignored = (what: string, raw: unknown) => {
    const kind = raw && typeof raw === "object" && "kind" in raw ? String((raw as { kind: unknown }).kind) : "?";
    opts.onIgnored?.(`${what} ignorada: kind "${kind}" desconocido o formato inesperado (¿servidor más nuevo?)`);
  };

  // La bandeja se valida entrega a entrega: una que esta versión no entiende no debe dejar sin las demás.
  async function lenientInbox(res: Response): Promise<InboxItem[]> {
    const data: unknown = await res.json().catch(() => undefined);
    if (!Array.isArray(data)) {
      throw new DeviApiError(res.status, { error: "Respuesta inesperada del servidor de Devi (¿versiones distintas?)", code: "bad_response" });
    }
    const out: InboxItem[] = [];
    for (const raw of data) {
      const r = InboxItemSchema.safeParse(raw);
      if (r.success) out.push(r.data);
      else ignored("entrega de la bandeja", raw);
    }
    return out;
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
      const q = callOpts.query ? `?${new URLSearchParams(callOpts.query)}` : "";
      const path = buildPath(route.path, callOpts.params ?? {}) + q;
      const hasBody = route.method === "POST" || route.method === "PATCH";
      const res = await send(route.method, path, hasBody ? { body: JSON.stringify(callOpts.body ?? {}), json: true } : {});
      if (name === "sessionInbox") return (await lenientInbox(res)) as never;
      return parsed(res, route.response, RAW_ROUTES.has(name));
    },

    async createDraft(meta, files) {
      const res = await send(API.createDraft.method, API.createDraft.path, { body: multipart(meta, files) });
      return parsed(res, CreateDraftResult);
    },

    async sendFromApp(meta, files) {
      const res = await send(API.sendFromApp.method, API.sendFromApp.path, { body: multipart(meta, files) });
      return parsed(res, DeviRequestSchema);
    },

    async sendChat(meta, files) {
      const res = await send(API.sendChat.method, API.sendChat.path, { body: multipart(meta, files) });
      return parsed(res, ChatMessageSchema);
    },

    async chatFromSession(meta, files) {
      const res = await send(API.chatFromSession.method, API.chatFromSession.path, { body: multipart(meta, files) });
      return parsed(res, ChatMessageSchema);
    },

    async chat(memberId, pageOpts = {}) {
      const path = buildPath(API.chatPage.path, { memberId }) + pageQuery(pageOpts);
      return parsed(await send(API.chatPage.method, path), ChatPageSchema);
    },

    async conversations() {
      return parsed(await send(API.conversations.method, API.conversations.path), ConversationsResponseSchema);
    },

    async conversation(memberId, pageOpts = {}) {
      const path = buildPath(API.conversation.path, { memberId }) + pageQuery(pageOpts);
      return parsed(await send(API.conversation.method, path), ConversationPageSchema);
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
          else ignored("entrega del canal", rawJson(f.data));
        },
      });
      return () => {
        hb.stop();
        stopSse();
      };
    },
  };
}

// Multipart de los envíos con archivos: "meta" (JSON) y un campo "files" por archivo de texto.
function multipart(meta: unknown, files: { name: string; content: string }[]): FormData {
  const form = new FormData();
  form.append("meta", JSON.stringify(meta));
  for (const f of files) form.append("files", new File([f.content], f.name, { type: "text/plain;charset=utf-8" }));
  return form;
}

function pageQuery(opts: { before?: number; limit?: number }): string {
  const q = new URLSearchParams();
  if (opts.before !== undefined) q.set("before", String(opts.before));
  if (opts.limit !== undefined) q.set("limit", String(opts.limit));
  return q.size > 0 ? `?${q}` : "";
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

function rawJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function safeJson<S extends z.ZodType>(text: string, schema: S): z.infer<S> | null {
  try {
    const r = schema.safeParse(JSON.parse(text));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}
