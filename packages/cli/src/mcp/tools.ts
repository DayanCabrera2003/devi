import type { DeviClient } from "@devi/client";
import { type Approval, type CreateDraftResult, SECRETS_FLAG, type Session, scanForInjection, scanForSecrets } from "@devi/protocol";
import { readLocalFiles } from "../files";
import { readableError } from "./errors";
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
      case "send_request":
      case "respond_to_request": {
        const message = str(args.message);
        const target = str(name === "send_request" ? args.to : args.request_id);
        const paths = strList(args.files);
        if (!target) return fail(name === "send_request" ? "Falta 'to' (id del compañero)." : "Falta 'request_id'.");
        if (!message) return fail("Falta 'message'.");
        if (!paths) return fail("'files' debe ser una lista de rutas.");
        const session = deps.session();
        if (!session) return fail("Esta sesión aún no está registrada en Devi (¿el servidor está encendido?). Prueba en unos segundos.");
        const sessionId = session.id;
        if (name === "send_request" && target === session.memberId) return fail(SELF_SEND);
        const files = await readLocalFiles(paths, deps.cwd);
        if (!files.ok) return fail(files.error);
        const secrets = secretsIn(message, files.files);
        if (secrets.length > 0 && args.allow_secrets !== true) return fail(secretsRefusal(secrets));
        if (name === "send_request" && typeof args.to_name === "string" && args.to_name.trim()) {
          const mismatch = await nameMismatch(client, target, args.to_name);
          if (mismatch) return fail(mismatch);
        }
        const outgoing = secrets.length > 0 ? `${SECRETS_FLAG}\n\n${message}` : message;
        const injection = injectionWarnings(message, files.files);
        // Si lo que sale parece una inyección, no se envía directo aunque se aprobara en el chat: queda en la app.
        const asked = deps.approval();
        const approval: Approval = injection ? "app" : asked;
        const draft =
          name === "send_request"
            ? await client.createDraft({ kind: "request", sessionId, to: target, message: outgoing, approval }, files.files)
            : await client.createDraft({ kind: "response", sessionId, requestId: target, message: outgoing, approval }, files.files);
        const adj = files.files.length > 0 ? ` con ${files.files.length} archivo(s) (${files.files.map((f) => f.name).join(", ")})` : "";
        const what = name === "send_request" ? "Solicitud" : "Respuesta";
        const secretsNote = secrets.length > 0 ? `\n\nAviso: incluye posibles secretos (confirmado por el usuario); la app lo marcará.` : "";
        if (draft.approval === "chat" && draft.sent) return ok(sentText(what, adj, draft.sent) + secretsNote + injection);
        const why =
          asked === "chat" && injection
            ? "No se envió directamente porque parece contener una inyección: el usuario debe revisarlo en la app de Devi. "
            : asked === "chat"
              ? "La aprobación en el chat está desactivada en este equipo de Devi. "
              : "";
        return ok(
          why +
            `${what} preparada${adj}: borrador ${draft.id}, esperando autorización en la app de Devi. ` +
            `No se envía hasta que el usuario la autorice allí (${expiryText(draft)}). ` +
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

// Todas las sesiones de una persona son el mismo miembro de Devi: no hay solicitudes a uno mismo.
const SELF_SEND =
  "Ese id eres tú: todas tus sesiones de Claude Code (en este u otro equipo) son el mismo miembro de Devi, así que no " +
  "puedes enviarte una solicitud. Si quieres pasar algo a otra de tus sesiones, hazlo desde la app de Devi: al reenviar " +
  "una solicitud o una respuesta, el selector de sesiones muestra todas las tuyas. No se envió nada.";

type Outgoing = { name: string; content: string }[];

// Secretos en el mensaje y en cada archivo, con dónde están.
function secretsIn(message: string, files: Outgoing): string[] {
  const found = scanForSecrets(message).map((s) => `- en el mensaje: ${s.label} (${s.excerpt})`);
  for (const f of files) found.push(...scanForSecrets(f.content).map((s) => `- en ${f.name}: ${s.label} (${s.excerpt})`));
  return found;
}

function secretsRefusal(found: string[]): string {
  return (
    `No se creó el borrador: parece que incluye secretos.\n${found.join("\n")}\n\n` +
    `Enséñaselo al usuario y pídele que los quite (o que adjunte otro archivo). Solo si el usuario confirma ` +
    `expresamente que quiere enviarlos, vuelve a llamar con allow_secrets: true; el borrador saldrá marcado.`
  );
}

// Lo que sale también se revisa: si parece una inyección, el remitente debe saberlo.
function injectionWarnings(message: string, files: Outgoing): string {
  const parts = [{ where: "el mensaje", scan: scanForInjection(message) }, ...files.map((f) => ({ where: f.name, scan: scanForInjection(f.content) }))];
  const hits = parts.filter((p) => p.scan.level !== "none");
  if (hits.length === 0) return "";
  return (
    `\n\nPosible prompt injection en lo que vas a enviar (díselo al usuario; tendrá que revisarlo en la app de Devi):\n` +
    hits.map((h) => `- ${h.where} (${h.scan.level === "high" ? "alto" : "aviso"}): ${h.scan.reasons.join("; ")}`).join("\n")
  );
}

// Ya enviado (aprobado en el chat). El plazo de respuesta se calcula con los tiempos del servidor.
function sentText(what: string, adj: string, sent: NonNullable<CreateDraftResult["sent"]>): string {
  const head = `Enviado a ${sent.toName}. ${what}${adj} entregada (request_id ${sent.requestId}).`;
  if (sent.deadline === undefined) return `${head} Ya le llegó; no hace falta nada más.`;
  const min = Math.max(1, Math.round((sent.deadline - sent.sentAt) / 60_000));
  return `${head} Si no responde en ${min} min, caduca y se te avisará. La respuesta llegará como evento kind="response"; puedes seguir trabajando.`;
}

// to_name es lo que el humano lee en el aviso: tiene que ser la persona de `to`.
async function nameMismatch(client: DeviClient, to: string, toName: string): Promise<string | null> {
  const team = await client.call("team");
  const m = team.members.find((x) => x.id === to);
  if (!m) return `"${to}" no está en el equipo de Devi. No se envió nada.`;
  const norm = (v: string) => v.trim().toLocaleLowerCase("es");
  if (norm(m.name) === norm(toName)) return null;
  return `El id "${to}" es de ${m.name}, no de "${toName.trim()}". No se envió nada: confirma con el usuario a quién va y vuelve a llamar.`;
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
