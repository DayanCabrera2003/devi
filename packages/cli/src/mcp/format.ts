import { join } from "node:path";
import { type DeviRequest, type Draft, type FileMeta, type RequestStatus, contextText, hasContext, neutralizeInline, wrapUntrusted } from "@devi/protocol";

// Texto compacto para el agente (encabezados y listas, no JSON). Todo lo que escribió un compañero va
// encuadrado (DEVI-UNTRUSTED) y los nombres, neutralizados: las herramientas de lectura no abren otra vía
// de prompt injection distinta de la de las entregas.

export type FormatCtx = {
  meId: string;
  names: ReadonlyMap<string, string>; // memberId → nombre
  now: number;
  sessionId: string | null; // esta sesión (para "reenviada a esta sesión")
  receivedDir: string;
};

export const STATUS_TEXT: Record<RequestStatus, string> = {
  pending: "pendiente (esperando que el destinatario decida en la app)",
  forwarded: "reenviada a una sesión de Claude Code del destinatario (en curso)",
  accepted: "aceptada",
  rejected: "rechazada",
  answered: "respondida",
  timed_out: "caducada sin respuesta",
  closed: "cerrada",
};
const OUTCOME_TEXT = { accepted: "aceptada", rejected: "rechazada", answered: "respondida" } as const;

export const inline = (s: string, max = 300) => neutralizeInline(s, max);

function span(ms: number): string {
  const min = Math.round(Math.abs(ms) / 60_000);
  if (min < 1) return "menos de 1 min";
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} h`;
  return `${Math.round(h / 24)} d`;
}

export const ago = (at: number, now: number) => (now - at < 60_000 ? "ahora mismo" : `hace ${span(now - at)}`);
export const until = (at: number, now: number) => (at <= now ? "ya venció" : `en ${span(at - now)}`);

export const nameOf = (ctx: FormatCtx, id: string) => (id === ctx.meId ? "tú" : inline(ctx.names.get(id) ?? id, 80));

const kb = (n: number) => `${Math.max(1, Math.ceil(n / 1024))} KB`;
const fileList = (fs: FileMeta[]) => fs.map((f) => `${inline(f.name, 200)} (${kb(f.size)})`).join(", ");

// "Tú → María" / "María → tú".
export function direction(r: DeviRequest, ctx: FormatCtx): string {
  const from = nameOf(ctx, r.fromMemberId);
  return `${from.charAt(0).toUpperCase()}${from.slice(1)} → ${nameOf(ctx, r.toMemberId)}`;
}

function origin(r: DeviRequest, ctx: FormatCtx): string {
  if (r.origin === "app") return r.fromMemberId === ctx.meId ? "escrita por ti en la app" : "escrita en la app";
  const who = r.fromMemberId === ctx.meId ? "tu sesión" : `la sesión de ${nameOf(ctx, r.fromMemberId)}`;
  return `desde ${who} "${inline(r.fromSessionName, 80)}"`;
}

function statusLine(r: DeviRequest, ctx: FormatCtx): string {
  let s = r.status === "closed" && r.outcome ? `cerrada (${OUTCOME_TEXT[r.outcome]})` : STATUS_TEXT[r.status];
  if (r.status === "forwarded" && r.toMemberId === ctx.meId) {
    s = r.forwardedSessionId && r.forwardedSessionId === ctx.sessionId ? "reenviada a esta sesión (puedes responder con respond_to_request)" : "reenviada a otra de tus sesiones";
  }
  if (r.status === "pending" || r.status === "forwarded") s += `; vence ${until(r.deadline, ctx.now)}`;
  return s;
}

// Texto de una de las partes: el mío, en una línea; el del compañero, encuadrado.
function authored(label: string, by: string, text: string, ctx: FormatCtx, max: number): string {
  const cut = text.length > max ? `${text.slice(0, max)}… [recortado: get_request lo da entero]` : text;
  if (by === ctx.meId) return `- ${label} (tuyo): ${inline(cut, max + 60)}`;
  return `- ${label}:\n${wrapUntrusted(label.split(" ")[0]!, nameOf(ctx, by), cut, [])}`;
}

// Una solicitud como bloque de lista. full = sin recortar el mensaje (get_request).
export function formatRequest(r: DeviRequest, ctx: FormatCtx, full = false): string {
  const max = full ? 20_000 : 600;
  const lines = [
    `### ${r.id} · ${direction(r, ctx)} · ${ago(r.sentAt, ctx.now)}`,
    `- Estado: ${statusLine(r, ctx)}`,
    `- Origen: ${origin(r, ctx)}`,
    authored("Mensaje", r.fromMemberId, r.message, ctx, max),
  ];
  if (hasContext(r.context)) lines.push(authored("Contexto", r.fromMemberId, contextText(r.context), ctx, max));
  if (r.outcomeText) lines.push(authored(`Respuesta (${r.outcome ? OUTCOME_TEXT[r.outcome] : "respuesta"})`, r.toMemberId, r.outcomeText, ctx, max));
  else if (r.outcome) lines.push(`- Resultado: ${OUTCOME_TEXT[r.outcome]}`);
  if (r.files.length > 0) {
    const local = r.toMemberId === ctx.meId ? ` → si ya se entregaron, en ${join(ctx.receivedDir, r.id)}/` : "";
    lines.push(`- Archivos de la solicitud: ${fileList(r.files)}${local}`);
  }
  if (r.responseFiles.length > 0) {
    const local = r.fromMemberId === ctx.meId ? ` → si ya se entregaron, en ${join(ctx.receivedDir, r.id, "respuesta")}/` : "";
    lines.push(`- Archivos de la respuesta: ${fileList(r.responseFiles)}${local}`);
  }
  return lines.join("\n");
}

export function formatDraft(d: Draft, ctx: FormatCtx, toOf: (requestId: string) => string): string {
  const to = d.kind === "request" ? nameOf(ctx, d.toMemberId) : `respuesta a ${d.requestId} (${toOf(d.requestId)})`;
  const files = d.files.length > 0 ? `\n- Archivos: ${fileList(d.files)}` : "";
  return `### ${d.id} · borrador para ${to} · caduca ${until(d.expiresAt, ctx.now)}\n- Mensaje (tuyo): ${inline(d.message, 400)}${files}`;
}
