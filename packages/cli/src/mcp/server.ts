import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createClient, type DeviClient } from "@devi/client";
import { sessionNameFor } from "../commands/claude";
import { loadClientConfig } from "../config";
import { debugPairing, pairing } from "../pairing";
import type { Sys } from "../paths";
import { CLI_VERSION } from "../version";
import { instructions } from "./instructions";
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

  let sessionId: string | null = null;
  const mcp = new Server(
    { name: "devi", version: CLI_VERSION },
    { capabilities: { experimental: { "claude/channel": {} }, tools: {} }, instructions: instructions(sessionName) },
  );
  mcp.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
  mcp.setRequestHandler(CallToolRequestSchema, async (req) =>
    callTool(req.params.name, req.params.arguments ?? {}, { client, configError, cwd, sessionId: () => sessionId }),
  );

  mcp.onclose = () => process.exit(0); // sin servidor configurado no hay nada que cerrar
  await mcp.connect(new StdioServerTransport());
  if (!client) return;
  const c = client;

  // Las entregas se procesan en orden (una descarga de archivos no adelanta a la siguiente).
  let queue = Promise.resolve();
  const stop = startSessionLoop({
    client: c,
    register: { name: sessionName, cwd, channel, ...pairing() },
    onSession: (id) => {
      sessionId = id;
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

  // Claude Code cierra stdin al terminar la sesión: se avisa al servidor y se sale.
  mcp.onclose = () => {
    stop();
    const id = sessionId;
    const done = () => process.exit(0);
    if (!id) return done();
    c.call("closeSession", { params: { id } }).catch(() => {}).finally(done);
    setTimeout(done, 1000).unref();
  };
}
