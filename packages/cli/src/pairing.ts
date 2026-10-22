import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { posix, win32 } from "node:path";
import { type Sys, appDataDir } from "./paths";

// Cómo se empareja el MCP con las sesiones de los hooks: los dos son hijos directos de Claude Code,
// así que comparten el PID del padre. Un pid solo es único dentro de una máquina (y mientras el proceso
// vive), por eso va siempre con el id de la máquina; el servidor solo empareja entre las sesiones activas
// de quien llama. DEVI_DEBUG_PAIRING permite comprobarlo en una máquina concreta.
export type Pairing = { parentPid: number; machine: string };

export function pairing(sys: Sys): Pairing {
  return { parentPid: process.ppid, machine: machineId(sys) };
}

function readId(file: string): string | null {
  try {
    return readFileSync(file, "utf8").trim() || null;
  } catch {
    return null;
  }
}

// Id estable de esta máquina para la cuenta del SO: se crea una vez en la carpeta de datos de Devi y lo
// comparten el MCP y los hooks. DEVI_MACHINE_ID lo fija (tests, contenedores clonados con la misma carpeta).
// Nunca lanza: si no se puede leer ni escribir, se usa el nombre del equipo.
export function machineId(sys: Sys): string {
  const fixed = sys.env.DEVI_MACHINE_ID?.trim();
  if (fixed) return fixed;
  const join = sys.platform === "win32" ? win32.join : posix.join;
  const dir = appDataDir(sys);
  const file = join(dir, "machine-id");
  const saved = readId(file);
  if (saved) return saved;
  try {
    mkdirSync(dir, { recursive: true });
    const id = crypto.randomUUID();
    writeFileSync(file, `${id}\n`, { flag: "wx" });
    return id;
  } catch {
    // Otro proceso lo creó a la vez (wx no sobrescribe): vale el suyo. Si no, no se puede escribir.
    return readId(file) ?? `host:${hostname()}`;
  }
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
