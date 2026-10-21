import type { DeviClient } from "@devi/client";
import { type Approval, type CreateDraftResult, SECRETS_FLAG, scanForInjection, scanForSecrets } from "@devi/protocol";
import { readLocalFiles } from "../files";
import { readableError } from "./errors";

export type ToolResult = { content: { type: "text"; text: string }[]; isError: boolean };

// Claude Code muestra el aviso de permisos de estas herramientas en CADA llamada, en cualquier modo de
// permisos y sin "no volver a preguntar": ese aviso es la aprobación del humano (ver approval.ts).
const ASK_EVERY_TIME = { "anthropic/requiresUserInteraction": true } as const;

const FILES_ARG = {
  type: "array",
  items: { type: "string" },
  description: "Opcional: rutas de los archivos de texto que se adjuntan (relativas a la carpeta de la sesión), máx. 5 de 1 MB",
};
const ALLOW_SECRETS_ARG = {
  type: "boolean",
  description:
    "Solo si el usuario confirmó expresamente enviar algo que parece un secreto (tras el aviso de Devi). Saldrá marcado con un aviso.",
};

export const TOOLS = [
  {
    name: "list_teammates",
    description:
      "Lista los compañeros conectados a Devi (excluyéndote), con sus roles, capacidades y descripción. Úsalo para decidir a quién pedir algo.",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "send_request",
    description:
      "Envía una solicitud a un compañero de Devi. Claude Code te pide aprobarla antes: revisa a quién va (to_name), el mensaje y los archivos; " +
      "al aprobar, se envía. Si la aprobación en el chat no está disponible, queda como borrador para autorizar en la app de Devi. " +
      "Úsalo solo después de que el usuario confirme el destinatario. La respuesta llegará más tarde como evento kind=\"response\".",
    inputSchema: {
      type: "object" as const,
      properties: {
        to: { type: "string", description: "id del compañero (de list_teammates)" },
        to_name: { type: "string", description: "Nombre del compañero tal como sale en list_teammates; Devi comprueba que es el de 'to'" },
        message: {
          type: "string",
          description: "Lo que se le envía: qué necesita el usuario, con el contexto suficiente para entenderlo sin ver esta sesión",
        },
        files: FILES_ARG,
        allow_secrets: ALLOW_SECRETS_ARG,
      },
      required: ["to", "message"],
    },
    _meta: ASK_EVERY_TIME,
  },
  {
    name: "respond_to_request",
    description:
      "Envía la respuesta a una solicitud de un compañero (evento kind=\"request\") con lo que el usuario decidió. Claude Code te pide " +
      "aprobarla antes: revisa el mensaje y los archivos; al aprobar, se envía. Si la aprobación en el chat no está disponible, queda como " +
      "borrador para autorizar en la app de Devi. Úsalo solo después de que el usuario lo diga.",
    inputSchema: {
      type: "object" as const,
      properties: {
        request_id: { type: "string", description: "request_id del evento de Devi" },
        message: { type: "string", description: "Lo que se le responde: lo que el usuario va a hacer o su respuesta, en sus palabras" },
        files: FILES_ARG,
        allow_secrets: ALLOW_SECRETS_ARG,
      },
      required: ["request_id", "message"],
    },
    _meta: ASK_EVERY_TIME,
  },
];

export type ToolDeps = {
  client: DeviClient | null; // null si la configuración no es válida
  configError: string | null;
  cwd: string;
  sessionId: () => string | null;
  approval: () => Approval; // dónde aprueba el humano (según el cliente MCP; ver approval.ts)
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
      case "list_teammates": {
        const [me, team] = await Promise.all([client.call("me"), client.call("team")]);
        const roles = new Map(team.roles.map((r) => [r.id, r]));
        const people = team.members
          .filter((m) => m.connected && !m.disabled && m.id !== me.member.id)
          .map((m) => {
            const rs = m.roleIds.map((id) => roles.get(id)).filter((r) => r !== undefined);
            return {
              id: m.id,
              name: m.name,
              roles: rs.map((r) => r.name),
              capabilities: [...new Set(rs.flatMap((r) => r.capabilities))],
              description: m.description,
            };
          });
        if (people.length === 0) return ok("No hay compañeros conectados a Devi ahora mismo.");
        return ok(JSON.stringify(people, null, 2));
      }
      case "send_request":
      case "respond_to_request": {
        const message = str(args.message);
        const target = str(name === "send_request" ? args.to : args.request_id);
        const paths = strList(args.files);
        if (!target) return fail(name === "send_request" ? "Falta 'to' (id del compañero)." : "Falta 'request_id'.");
        if (!message) return fail("Falta 'message'.");
        if (!paths) return fail("'files' debe ser una lista de rutas.");
        const sessionId = deps.sessionId();
        if (!sessionId) return fail("Esta sesión aún no está registrada en Devi (¿el servidor está encendido?). Prueba en unos segundos.");
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
    return fail(readableError(e));
  }
}

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
