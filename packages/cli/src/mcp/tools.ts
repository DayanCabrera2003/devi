import type { DeviClient } from "@devi/client";
import { readLocalFiles } from "../files";
import { readableError } from "./errors";

export type ToolResult = { content: { type: "text"; text: string }[]; isError: boolean };

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
      "Prepara una solicitud para un compañero. Crea un BORRADOR que el usuario debe autorizar en la app de Devi; no se envía hasta entonces. Úsalo solo después de que el usuario confirme el destinatario. La respuesta llegará más tarde como evento kind=\"response\".",
    inputSchema: {
      type: "object" as const,
      properties: {
        to: { type: "string", description: "id del compañero (de list_teammates)" },
        message: {
          type: "string",
          description: "Qué necesita el usuario, con el contexto suficiente para entenderlo sin ver esta sesión",
        },
        files: {
          type: "array",
          items: { type: "string" },
          description: "Opcional: rutas de archivos de texto a adjuntar (relativas a la carpeta de la sesión), máx. 5 de 1 MB",
        },
      },
      required: ["to", "message"],
    },
  },
  {
    name: "respond_to_request",
    description:
      "Prepara la respuesta a una solicitud de un compañero (evento kind=\"request\") con lo que el usuario decidió. Crea un BORRADOR que el usuario debe autorizar en la app de Devi. Úsalo solo después de que el usuario lo diga.",
    inputSchema: {
      type: "object" as const,
      properties: {
        request_id: { type: "string", description: "request_id del evento de Devi" },
        message: { type: "string", description: "Lo que el usuario va a hacer o su respuesta, en sus palabras" },
        files: {
          type: "array",
          items: { type: "string" },
          description: "Opcional: rutas de archivos de texto a adjuntar (relativas a la carpeta de la sesión), máx. 5 de 1 MB",
        },
      },
      required: ["request_id", "message"],
    },
  },
];

export type ToolDeps = {
  client: DeviClient | null; // null si la configuración no es válida
  configError: string | null;
  cwd: string;
  sessionId: () => string | null;
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
        const draft =
          name === "send_request"
            ? await client.createDraft({ kind: "request", sessionId, to: target, message }, files.files)
            : await client.createDraft({ kind: "response", sessionId, requestId: target, message }, files.files);
        const adj = files.files.length > 0 ? ` con ${files.files.length} archivo(s) (${files.files.map((f) => f.name).join(", ")})` : "";
        const what = name === "send_request" ? "Solicitud" : "Respuesta";
        return ok(
          `${what} preparada${adj}: borrador ${draft.id}, esperando autorización en la app de Devi. ` +
            `No se envía hasta que el usuario la autorice allí (caduca en 15 min). ` +
            `Te llegará un evento kind="draft_authorized" o kind="draft_discarded". Puedes seguir trabajando.`,
        );
      }
      default:
        return fail(`Herramienta desconocida: ${name}`);
    }
  } catch (e) {
    return fail(readableError(e));
  }
}
