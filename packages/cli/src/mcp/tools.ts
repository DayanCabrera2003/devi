import type { DeviClient } from "@devi/client";
import {
  type Approval, type CreateDraftResult, type GitContext, SECRETS_FLAG, type Session,
} from "@devi/protocol";
import { readLocalFiles } from "../files";
import { declineRequest, takeRequest } from "./attend-tools";
import { replyInChat } from "./chat-tool";
import { type ContextResult, contextNote, outgoingContext } from "./context-arg";
import { readableError } from "./errors";
import { injectionWarnings, nameMismatch, secretsIn, secretsRefusal } from "./outgoing";
import { collectGitContext } from "./git-context";
import { searchKnowledge } from "./knowledge-tool";
import { ToolInputError, getConversation, getRequest, listPending, listTeammates, whoami } from "./read-tools";

export type ToolResult = { content: { type: "text"; text: string }[]; isError: boolean };

export { TOOLS } from "./tool-defs";

export type ToolDeps = {
  client: DeviClient | null; // null si la configuración no es válida
  configError: string | null;
  cwd: string;
  session: () => Session | null; // la sesión de Devi de esta conexión (null hasta registrarse)
  approval: () => Approval; // dónde aprueba el humano (según el cliente MCP; ver approval.ts)
  receivedDir?: string; // carpeta de archivos recibidos (para mostrar sus rutas locales)
  now?: () => number;
  gitContext?: (cwd: string) => Promise<GitContext | undefined>; // rama, commit y diff --stat de la sesión (pruebas: falso)
};

const ok = (text: string): ToolResult => ({ content: [{ type: "text", text }], isError: false });
const fail = (text: string): ToolResult => ({ content: [{ type: "text", text }], isError: true });

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const strList = (v: unknown): string[] | null =>
  v === undefined ? [] : Array.isArray(v) && v.every((x) => typeof x === "string") ? v : null;

export async function callTool(name: string, args: Record<string, unknown>, deps: ToolDeps): Promise<ToolResult> {
  if (!deps.client) return fail(deps.configError ?? "Devi no está configurado.");
  const client = deps.client;
  try {
    switch (name) {
      case "whoami":
        return ok(await whoami(readDeps(client, deps)));
      case "list_teammates":
        return ok(await listTeammates(readDeps(client, deps)));
      case "get_conversation":
        return ok(await getConversation(readDeps(client, deps), args));
      case "list_pending":
        return ok(await listPending(readDeps(client, deps)));
      case "get_request":
        return ok(await getRequest(readDeps(client, deps), args));
      case "search_knowledge":
        return ok(await searchKnowledge(client, args));
      case "take_request":
        return ok(await takeRequest(attendDeps(client, deps), args));
      case "decline_request":
        return ok(await declineRequest(attendDeps(client, deps), args));
      case "reply_in_chat":
        return await replyInChat({ client, cwd: deps.cwd, session: deps.session, approval: deps.approval }, args);
      case "send_request":
      case "respond_to_request": {
        const message = str(args.message);
        const target = str(name === "send_request" ? args.to : args.request_id);
        const paths = strList(args.files);
        if (!target) return fail(name === "send_request" ? "Falta 'to' (id del compañero)." : "Falta 'request_id'.");
        if (!message) return fail("Falta 'message'.");
        if (!paths) return fail("'files' debe ser una lista de rutas.");
        const requestKind = args.kind === undefined ? "request" : args.kind;
        if (requestKind !== "request" && requestKind !== "handoff") return fail("'kind' debe ser \"request\" o \"handoff\".");
        const handoff = name === "send_request" && requestKind === "handoff";
        const session = deps.session();
        if (!session) return fail("Esta sesión aún no está registrada en Devi (¿el servidor está encendido?). Prueba en unos segundos.");
        const sessionId = session.id;
        if (name === "send_request" && target === session.memberId) return fail(SELF_SEND);
        const files = await readLocalFiles(paths, deps.cwd);
        if (!files.ok) return fail(files.error);
        const ctx: ContextResult = name === "send_request"
          ? await outgoingContext(args.context, () => (deps.gitContext ?? collectGitContext)(deps.cwd))
          : { ok: true, context: undefined };
        if (!ctx.ok) return fail(ctx.error);
        const context = ctx.context;
        const secrets = secretsIn(message, files.files, context);
        if (secrets.length > 0 && args.allow_secrets !== true) return fail(secretsRefusal(secrets));
        if (name === "send_request" && typeof args.to_name === "string" && args.to_name.trim()) {
          const mismatch = await nameMismatch(client, target, args.to_name);
          if (mismatch) return fail(mismatch);
        }
        const outgoing = secrets.length > 0 ? `${SECRETS_FLAG}\n\n${message}` : message;
        // Guardar en la base del equipo: nunca con posibles secretos (el servidor también lo comprueba).
        const shareAsked = name === "respond_to_request" && args.share_with_team === true;
        const share = shareAsked && secrets.length === 0;
        const injection = injectionWarnings(message, files.files, context);
        // Si lo que sale parece una inyección, no se envía directo aunque se aprobara en el chat: queda en la app.
        const asked = deps.approval();
        const approval: Approval = injection ? "app" : asked;
        const draft =
          name === "send_request"
            ? await client.createDraft(
                {
                  kind: "request", sessionId, to: target, message: outgoing, approval,
                  ...(context ? { context } : {}), ...(handoff ? { requestKind: "handoff" as const } : {}),
                },
                files.files,
              )
            : await client.createDraft({ kind: "response", sessionId, requestId: target, message: outgoing, approval, ...(share ? { shareWithTeam: true } : {}) }, files.files);
        const adj = files.files.length > 0 ? ` con ${files.files.length} archivo(s) (${files.files.map((f) => f.name).join(", ")})` : "";
        const what = handoff ? "Traspaso" : name === "send_request" ? "Solicitud" : "Respuesta";
        const secretsNote =
          (secrets.length > 0 ? `\n\nAviso: incluye posibles secretos (confirmado por el usuario); la app lo marcará.` : "") + contextNote(context) +
          (share ? `\n\n${SHARE_NOTE}` : shareAsked ? `\n\n${NO_SHARE_NOTE}` : "");
        if (draft.approval === "chat" && draft.sent) return ok(sentText(what, adj, draft.sent) + secretsNote + injection);
        const why =
          asked === "chat" && injection
            ? "No se envió directamente porque parece contener una inyección: el usuario debe revisarlo en la app de Devi. "
            : asked === "chat"
              ? "La aprobación en el chat está desactivada en este equipo de Devi. "
              : "";
        return ok(
          why +
            `${what} ${handoff ? "preparado" : "preparada"}${adj}: borrador ${draft.id}, esperando autorización en la app de Devi. ` +
            `No se envía hasta que el usuario ${handoff ? "lo" : "la"} autorice allí (${expiryText(draft)}). ` +
            `Te llegará un evento kind="draft_authorized" o kind="draft_discarded". Puedes seguir trabajando.` +
            secretsNote +
            injection,
        );
      }
      default:
        return fail(`Herramienta desconocida: ${name}`);
    }
  } catch (e) {
    return fail(e instanceof ToolInputError ? e.message : readableError(e));
  }
}

const readDeps = (client: DeviClient, deps: ToolDeps) => ({
  client, session: deps.session, receivedDir: deps.receivedDir ?? "", now: deps.now ?? Date.now,
});

const attendDeps = (client: DeviClient, deps: ToolDeps) => ({
  client, session: deps.session, approval: deps.approval, receivedDir: deps.receivedDir ?? "",
});

// Todas las sesiones de una persona son el mismo miembro de Devi: no hay solicitudes a uno mismo.
const SELF_SEND =
  "Ese id eres tú: todas tus sesiones de Claude Code (en este u otro equipo) son el mismo miembro de Devi, así que no " +
  "puedes enviarte una solicitud. Si quieres pasar algo a otra de tus sesiones, hazlo desde la app de Devi: al reenviar " +
  "una solicitud o una respuesta, el selector de sesiones muestra todas las tuyas. No se envió nada.";

const SHARE_NOTE =
  "Al enviarse se guardará en la base del equipo (pregunta y respuesta, sin archivos). Si Devi detecta posibles secretos " +
  "en la pregunta original, no se publica y la app de Devi avisa al usuario.";
const NO_SHARE_NOTE = "No se guardará en la base del equipo: incluye posibles secretos.";

// Ya enviado (aprobado en el chat). El plazo de respuesta se calcula con los tiempos del servidor.
function sentText(what: string, adj: string, sent: NonNullable<CreateDraftResult["sent"]>): string {
  const head = `Enviado a ${sent.toName}. ${what}${adj} ${what === "Traspaso" ? "entregado" : "entregada"} (request_id ${sent.requestId}).`;
  if (sent.deadline === undefined) return `${head} Ya le llegó; no hace falta nada más.`;
  const min = Math.max(1, Math.round((sent.deadline - sent.sentAt) / 60_000));
  return `${head} Si no responde en ${min} min, caduca y se te avisará. La respuesta llegará como evento kind="response"; puedes seguir trabajando.`;
}

// El plazo es un ajuste del servidor (draftTtlMs): se calcula con los dos tiempos del servidor,
// así no depende del reloj de este equipo.
function expiryText(draft: { createdAt?: unknown; expiresAt?: unknown }): string {
  const { createdAt, expiresAt } = draft;
  if (typeof createdAt !== "number" || typeof expiresAt !== "number" || expiresAt <= createdAt) {
    return "caduca si no la autoriza a tiempo";
  }
  return `caduca en ${Math.max(1, Math.round((expiresAt - createdAt) / 60_000))} min`;
}
