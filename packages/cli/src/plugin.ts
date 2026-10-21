import type { HookEvent } from "./args";
import { MARKETPLACE_NAME, PLUGIN_NAME } from "./paths";

const DESCRIPTION = "Devi: conecta las sesiones de Claude Code de tu equipo (solicitudes, respuestas y archivos con autorización humana)";

// Ficheros del marketplace local con el plugin de Devi. `bin` es la ruta absoluta del binario
// estable (o "devi" para la copia de referencia del repo, que lo busca en el PATH).
export function pluginFiles(bin: string, version: string): Record<string, unknown> {
  // SessionStart y UserPromptSubmit recogen además la bandeja cuando no hay canal (plazo de ~4 s): timeout 10.
  const hook = (event: HookEvent, timeout: number) => [
    { hooks: [{ type: "command", command: bin, args: ["hook", event], timeout }] },
  ];
  return {
    ".claude-plugin/marketplace.json": {
      name: MARKETPLACE_NAME,
      owner: { name: "Devi" },
      metadata: { description: "Marketplace local de Devi (lo genera `devi install-integration`)" },
      plugins: [{ name: PLUGIN_NAME, source: `./${PLUGIN_NAME}`, description: DESCRIPTION, version }],
    },
    [`${PLUGIN_NAME}/.claude-plugin/plugin.json`]: {
      name: PLUGIN_NAME,
      version,
      description: DESCRIPTION,
      author: { name: "Devi" },
      mcpServers: { devi: { command: bin, args: ["mcp"] } },
      channels: [{ server: "devi", displayName: "Devi" }],
      hooks: { SessionStart: hook("start", 10), UserPromptSubmit: hook("working", 10), Stop: hook("idle", 5) },
    },
  };
}

export const renderJson = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;
