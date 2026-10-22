import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createClient, type DeviClient } from "@devi/client";
import type { Session } from "@devi/protocol";
import { sessionNameFor } from "../commands/claude";
import { loadClientConfig } from "../config";
import { debugPairing, pairing } from "../pairing";
import type { Sys } from "../paths";
import { CLI_VERSION } from "../version";
import { approvalFor } from "./approval";
import { instructions } from "./instructions";
import { onShutdown } from "./lifecycle";
import { relayDelivery } from "./relay";
import { startSessionLoop } from "./session";
import { TOOLS, callTool } from "./tools";

// stdout es del protocolo MCP: todo lo demás va a stderr.
const log = (...a: unknown[]) => console.error("[devi]", ...a);

export async function runMcp(sys: Sys): Promise<void> {
  console.log = console.error; // por si alguna dependencia escribe en stdout
  const cwd = sys.env.CLAUDE_PROJECT_DIR || process.cwd();
  const sessionName = sessionNameFor(sys.env.DEVI_SESSION || undefined, cwd);
  // Solo `devi claude` con un flag de canal lo pone. Sin él, Claude Code descarta las notificaciones del canal.
  const channel = sys.env.DEVI_CHANNEL === "1";
  debugPairing("mcp", { cwd, sessionName });

  let client: DeviClient | null = null;
  let configError: string | null = null;
  let receivedDir = "";
  try {
    const cfg = await loadClientConfig(sys);
    client = createClient({ baseUrl: cfg.serverUrl, devUser: cfg.devUser });
    receivedDir = cfg.receivedDir;
  } catch (e) {
    configError = (e as Error).message;
    log(configError);
  }

  let session: Session | null = null;
  const mcp = new Server(
    { name: "devi", version: CLI_VERSION },
    { capabilities: { experimental: { "claude/channel": {} }, tools: {} }, instructions: instructions(sessionName) },
  );
  mcp.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
  // Dónde aprueba el humano los envíos: se decide con el clientInfo del initialize (o DEVI_APPROVAL).
  const approval = () => approvalFor(mcp.getClientVersion(), sys.env.DEVI_APPROVAL);
  mcp.oninitialized = () => {
    const c = mcp.getClientVersion();
    log(`cliente MCP: ${c ? `${c.name} ${c.version}` : "desconocido"}; los envíos se aprueban en ${approval() === "chat" ? "el chat" : "la app de Devi"}`);
  };
  mcp.setRequestHandler(CallToolRequestSchema, async (req) =>
    callTool(req.params.name, req.params.arguments ?? {}, { client, configError, cwd, session: () => session, approval }),
  );

  // Fin del proceso: Claude Code cierra stdin al terminar la sesión (o manda una señal). Se cierra la sesión
  // en el servidor (sus entregas reenviadas vuelven a la app) y se sale; sin servidor no hay nada que cerrar.
  let stop = () => {};
  const shutdown = onShutdown({ stdin: process.stdin, proc: process }, async () => {
    stop();
    const id = session?.id;
    session = null;
    if (client && id) await client.call("closeSession", { params: { id } });
  });
  mcp.onclose = () => shutdown("mcp");
  await mcp.connect(new StdioServerTransport());
  if (!client) return;
  const c = client;

  // Identidad de esta sesión (ver docs/arquitectura.md, "Identidad y sesiones"): la persona sale del login;
  // máquina + pid de Claude Code + instanceId distinguen esta sesión de las demás de la misma persona.
  const register = {
    name: sessionName, cwd, channel, ...pairing(sys),
    instanceId: crypto.randomUUID(),
    ...(sys.env.CLAUDE_CODE_SESSION_ID ? { claudeSessionId: sys.env.CLAUDE_CODE_SESSION_ID } : {}),
  };

  // Las entregas se procesan en orden (una descarga de archivos no adelanta a la siguiente).
  let queue = Promise.resolve();
  stop = startSessionLoop({
    client: c,
    register,
    onSession: (s) => {
      session = s;
    },
    onDelivery: (d) => {
      queue = queue.then(() =>
        relayDelivery(d, {
          channel, client: c, receivedDir, log,
          notify: (msg) => mcp.notification({ method: "notifications/claude/channel", params: msg }),
        }),
      );
    },
    log,
  });
}
