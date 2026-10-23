import type { DeviClient } from "@devi/client";
import { type Approval, SECRETS_FLAG, type Session } from "@devi/protocol";
import { readLocalFiles } from "../files";
import { injectionWarnings, nameMismatch, secretsIn, secretsRefusal } from "./outgoing";
import type { ToolResult } from "./tools";

type ChatDeps = { client: DeviClient; cwd: string; session: () => Session | null; approval: () => Approval };

const ok = (text: string): ToolResult => ({ content: [{ type: "text", text }], isError: false });
const fail = (text: string): ToolResult => ({ content: [{ type: "text", text }], isError: true });
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

// Un mensaje del chat no tiene borrador: o lo aprueba el humano en el aviso de Claude Code, o lo escribe en la app.
const NEEDS_APP =
  "No se envió: escribir en el chat desde aquí necesita la aprobación en el aviso de Claude Code, y no está disponible " +
  "en esta sesión. Dile al usuario que lo escriba en la app de Devi.";

// reply_in_chat: Claude escribe en el chat con un compañero, solo cuando su usuario se lo pide. Mismas revisiones que
// send_request (destinatario, secretos e inyección); con una posible inyección no sale nada.
export async function replyInChat(deps: ChatDeps, args: Record<string, unknown>): Promise<ToolResult> {
  const to = str(args.to);
  const message = str(args.message);
  const paths = args.files === undefined ? [] : Array.isArray(args.files) && args.files.every((x) => typeof x === "string") ? args.files : null;
  if (!to) return fail("Falta 'to' (id del compañero).");
  if (!message) return fail("Falta 'message'.");
  if (!paths) return fail("'files' debe ser una lista de rutas.");
  const session = deps.session();
  if (!session) return fail("Esta sesión aún no está registrada en Devi (¿el servidor está encendido?). Prueba en unos segundos.");
  if (to === session.memberId) return fail("Ese id eres tú: no hay chat contigo mismo. No se envió nada.");
  if (deps.approval() !== "chat") return fail(NEEDS_APP);
  const files = await readLocalFiles(paths, deps.cwd);
  if (!files.ok) return fail(files.error);
  const secrets = secretsIn(message, files.files);
  if (secrets.length > 0 && args.allow_secrets !== true) return fail(secretsRefusal(secrets).replace("No se creó el borrador", "No se envió"));
  const injection = injectionWarnings(message, files.files);
  if (injection) return fail(`No se envió: parece contener una inyección. Si de verdad quiere mandarlo, que lo escriba en la app de Devi.${injection}`);
  if (typeof args.to_name === "string" && args.to_name.trim()) {
    const mismatch = await nameMismatch(deps.client, to, args.to_name);
    if (mismatch) return fail(mismatch);
  }
  const text = secrets.length > 0 ? `${SECRETS_FLAG}\n\n${message}` : message;
  const sent = await deps.client.chatFromSession({ sessionId: session.id, to, text, approval: "chat" }, files.files);
  const team = await deps.client.call("team");
  const name = team.members.find((m) => m.id === sent.toMemberId)?.name ?? sent.toMemberId;
  const adj = files.files.length > 0 ? ` con ${files.files.length} archivo(s)` : "";
  return ok(`Enviado a ${name} en el chat de Devi${adj}. Es un mensaje, no una solicitud: no hay plazo ni respuesta que esperar.`);
}
