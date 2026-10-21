import { appendFileSync } from "node:fs";

// Cómo se empareja el MCP con las sesiones de los hooks: los dos son hijos directos de Claude Code,
// así que comparten el PID del padre. Se verifica en la Task 17 de la Fase 2 (y si falla se aplica el plan B ahí).
export type Pairing = { parentPid: number };

export function pairing(): Pairing {
  return { parentPid: process.ppid };
}

// DEVI_DEBUG_PAIRING=<fichero>: el MCP y los hooks anotan su pid/ppid para verificar el emparejamiento.
export function debugPairing(who: string, extra: Record<string, unknown> = {}): void {
  const file = process.env.DEVI_DEBUG_PAIRING;
  if (!file) return;
  try {
    appendFileSync(file, `${JSON.stringify({ who, pid: process.pid, ppid: process.ppid, ...extra })}\n`);
  } catch {
    // solo diagnóstico
  }
}
