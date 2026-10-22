import type { HookEvent } from "./args";
import { MARKETPLACE_NAME, PLUGIN_NAME } from "./paths";
// Guía completa para el agente (skill "devi" del plugin). Se incrusta en el binario.
import SKILL from "./skill.md" with { type: "text" };

const REPO = "https://github.com/DayanCabrera2003/devi";
const AUTHOR = { name: "Dayan Cabrera", url: "https://github.com/DayanCabrera2003" };
const KEYWORDS = ["equipo", "solicitudes", "permisos", "revisiones", "mcp", "canal"];
const DESCRIPTION = "Devi: conecta las sesiones de Claude Code de tu equipo (solicitudes, respuestas y archivos con autorización humana)";

// Ficheros del marketplace local con el plugin de Devi (objetos → JSON; textos, tal cual). `bin` es la ruta absoluta del binario
// estable (o "devi" para la copia de referencia del repo, que lo busca en el PATH).
export function pluginFiles(bin: string, version: string): Record<string, unknown> {
  // SessionStart y UserPromptSubmit recogen además la bandeja cuando no hay canal (plazo de ~4 s): timeout 10.
  const hook = (event: HookEvent, timeout: number) => [
    { hooks: [{ type: "command", command: bin, args: ["hook", event], timeout }] },
  ];
  return {
    ".claude-plugin/marketplace.json": {
      name: MARKETPLACE_NAME,
      owner: AUTHOR,
      metadata: { description: "Marketplace local de Devi (lo genera `devi install-integration`)" },
      plugins: [{ name: PLUGIN_NAME, source: `./${PLUGIN_NAME}`, description: DESCRIPTION, version }],
    },
    [`${PLUGIN_NAME}/.claude-plugin/plugin.json`]: {
      name: PLUGIN_NAME,
      displayName: "Devi",
      version,
      description: DESCRIPTION,
      author: AUTHOR,
      homepage: REPO,
      repository: REPO,
      keywords: KEYWORDS,
      mcpServers: { devi: { command: bin, args: ["mcp"] } },
      channels: [{ server: "devi", displayName: "Devi" }],
      hooks: { SessionStart: hook("start", 10), UserPromptSubmit: hook("working", 10), Stop: hook("idle", 5) },
    },
    // Claude Code descubre las skills en skills/<nombre>/SKILL.md: se invoca como /devi:devi o sola cuando encaja.
    [`${PLUGIN_NAME}/skills/devi/SKILL.md`]: SKILL,
  };
}

export const renderFile = (v: unknown) => (typeof v === "string" ? v : `${JSON.stringify(v, null, 2)}\n`);
