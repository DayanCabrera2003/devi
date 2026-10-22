// Conversaciones por persona, envío desde la app y archivos nativos. Los nombres de tipos, rutas,
// comandos y eventos reflejan los de @devi/protocol y src-tauri, para cambiarlos por esas
// importaciones sin tocar a quien los usa.
import type { DeviRequest } from "@devi/protocol";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { DeviApi } from "./api";

// ---- HTTP -----------------------------------------------------------------------------

// Quién creó la solicitud: una sesión de Claude Code o la propia app (sin nombre de sesión).
export type RequestOrigin = "session" | "app";
export type ThreadRequest = DeviRequest & { origin?: RequestOrigin };

export type ConversationItem = {
  memberId: string;
  lastAt: number | null;
  lastPreview: string | null;
  lastFromMe: boolean;
  waitingOnMe: number;
};
export type ConversationsResponse = { items: ConversationItem[] };
export type ConversationPage = { requests: ThreadRequest[]; nextBefore?: number }; // lo más nuevo primero

export type SendMeta = { to: string; message: string };
export type OutgoingFile = { name: string; content: string };

export const CONVERSATION_ROUTES = {
  sendFromApp: { method: "POST", path: "/api/v1/requests" },
  conversations: { method: "GET", path: "/api/v1/conversations" },
  conversation: { method: "GET", path: "/api/v1/conversations/:memberId" },
} as const;

// Evento SSE de usuario: algo cambió en la conversación con esa persona.
export const CONVERSATION_UPDATED = "conversation.updated";
export type ConversationUpdated = { type: typeof CONVERSATION_UPDATED; memberId: string };

export function isConversationUpdated(ev: unknown): ev is ConversationUpdated {
  const e = ev as { type?: unknown; memberId?: unknown } | null;
  return !!e && e.type === CONVERSATION_UPDATED && typeof e.memberId === "string";
}

export interface ConversationsHttp {
  conversations(): Promise<ConversationsResponse>;
  conversation(memberId: string, opts?: { before?: number; limit?: number }): Promise<ConversationPage>;
  sendFromApp(meta: SendMeta, files: OutgoingFile[]): Promise<ThreadRequest>;
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

// Validación mínima: el contenido viene de la red.
function parseConversations(data: unknown): ConversationsResponse {
  if (!isObject(data) || !Array.isArray(data.items)) throw new Error("Respuesta inesperada del servidor al pedir las conversaciones");
  const items = data.items.filter(
    (i): i is ConversationItem => isObject(i) && typeof i.memberId === "string" && typeof i.waitingOnMe === "number",
  );
  return { items };
}

function parsePage(data: unknown): ConversationPage {
  if (!isObject(data) || !Array.isArray(data.requests)) throw new Error("Respuesta inesperada del servidor al pedir la conversación");
  const requests = data.requests.filter((r): r is ThreadRequest => isObject(r) && typeof r.id === "string");
  return typeof data.nextBefore === "number" ? { requests, nextBefore: data.nextBefore } : { requests };
}

export function conversationsHttp(api: Pick<DeviApi, "fetchJson">): ConversationsHttp {
  return {
    async conversations() {
      return parseConversations(await api.fetchJson(CONVERSATION_ROUTES.conversations.path));
    },
    async conversation(memberId, opts = {}) {
      const query: Record<string, string> = {};
      if (opts.before !== undefined) query.before = String(opts.before);
      if (opts.limit !== undefined) query.limit = String(opts.limit);
      const path = CONVERSATION_ROUTES.conversation.path.replace(":memberId", encodeURIComponent(memberId));
      return parsePage(await api.fetchJson(path, { query }));
    },
    async sendFromApp(meta, files) {
      const form = new FormData();
      form.append("meta", JSON.stringify(meta));
      for (const f of files) form.append("files", new Blob([f.content], { type: "text/plain" }), f.name);
      const r = await api.fetchJson(CONVERSATION_ROUTES.sendFromApp.path, { method: "POST", body: form });
      if (!isObject(r) || typeof r.id !== "string") throw new Error("Respuesta inesperada del servidor al enviar");
      return r as ThreadRequest;
    },
  };
}

// ---- nativo (Rust) -------------------------------------------------------------------

// Archivo elegido o soltado: Rust lo lee y guarda; la app solo ve un token y una vista previa.
export type PickedFile = { token: string; name: string; size: number; preview: string };
export type RejectedFile = { name: string; reason: string };
export type PickResult = { files: PickedFile[]; rejected: RejectedFile[] };

export const FILE_COMMANDS = { pick: "pick_files", take: "take_files", discard: "discard_files" } as const;
export const FILE_EVENTS = { dropped: "devi://files-dropped", dragHover: "devi://drag-hover" } as const;

export interface NativeFiles {
  pickFiles(): Promise<PickResult>;
  takeFiles(tokens: string[]): Promise<OutgoingFile[]>;
  discardFiles(tokens: string[]): Promise<void>;
  onFilesDropped(cb: (r: PickResult) => void): Promise<() => void>;
  onDragHover(cb: (s: { active: boolean }) => void): Promise<() => void>;
}

export const nativeFiles: NativeFiles = {
  pickFiles: () => invoke<PickResult>(FILE_COMMANDS.pick),
  takeFiles: (tokens) => invoke<OutgoingFile[]>(FILE_COMMANDS.take, { tokens }),
  discardFiles: (tokens) => invoke<void>(FILE_COMMANDS.discard, { tokens }),
  onFilesDropped: (cb) => listen<PickResult>(FILE_EVENTS.dropped, (e) => cb(e.payload)),
  onDragHover: (cb) => listen<{ active: boolean }>(FILE_EVENTS.dragHover, (e) => cb(e.payload)),
};
