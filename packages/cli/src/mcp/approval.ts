import type { Approval } from "@devi/protocol";

// Nombre que manda Claude Code en el clientInfo del initialize de MCP (visto en su binario:
// new Client({ name: "claude-code", title: "Claude Code", version })).
export const CLAUDE_CODE_CLIENT = "claude-code";

// Primera versión de Claude Code que damos por buena para _meta["anthropic/requiresUserInteraction"].
// El changelog no anota cuándo llegó; la primera mención es 2.1.246 ("Fixed MCP tools marked
// requiresUserInteraction still offering 'Yes, and don't ask again'..."). Desde ahí el aviso sale en cada
// llamada y sin opción de "no volver a preguntar"; antes podía quedar aprobado para siempre.
export const MIN_CLAUDE_CODE_VERSION = "2.1.246";

export type ClientInfo = { name: string; version: string };

// "1.2.3" o "1.2.3-beta.1" → [1, 2, 3]; cualquier otra cosa → null.
function parseVersion(v: string): number[] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function atLeast(version: string, min: string): boolean {
  const a = parseVersion(version);
  const b = parseVersion(min)!;
  if (!a) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! > b[i]!;
  return true;
}

// Dónde aprueba el humano los envíos de esta sesión. "chat" solo si el cliente es un Claude Code que muestra
// el aviso de permisos en cada llamada; si no, "app" (borrador en la app de Devi). DEVI_APPROVAL=app|chat
// manda sobre la detección.
export function approvalFor(client: ClientInfo | undefined, override: string | undefined): Approval {
  const forced = override?.trim().toLowerCase();
  if (forced === "app" || forced === "chat") return forced;
  if (client?.name === CLAUDE_CODE_CLIENT && atLeast(client.version, MIN_CLAUDE_CODE_VERSION)) return "chat";
  return "app";
}
