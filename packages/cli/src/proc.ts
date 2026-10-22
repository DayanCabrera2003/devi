import { homedir } from "node:os";
import { claudeSpawnEnv, findClaude } from "./claude-bin";

// Ejecutar programas externos (claude, tailscale) sin shell y de forma portable.
export type RunResult = { code: number; stdout: string; stderr: string };

// En Windows, `claude` instalado con npm es un .cmd: hay que pasar por cmd.exe.
// Cita un argumento para cmd.exe: vacío → "", `%` → `%%`, `!` → `^!`, comillas dobladas.
export function quoteCmdArg(a: string): string {
  if (a === "") return '""';
  const escaped = a.replace(/%/g, "%%").replace(/!/g, "^!");
  return /[\s"&|<>^]/.test(a) ? `"${escaped.replace(/"/g, '""')}"` : escaped;
}

export function spawnArgv(resolved: string, args: string[], platform: NodeJS.Platform): string[] {
  if (platform === "win32" && /\.(cmd|bat)$/i.test(resolved)) {
    return ["cmd.exe", "/d", "/s", "/c", [resolved, ...args].map(quoteCmdArg).join(" ")];
  }
  return [resolved, ...args];
}

export function which(cmd: string): string | null {
  return Bun.which(cmd);
}

// Devuelve null si el programa no está en el PATH. Nunca lanza por timeout: mata el proceso y devuelve code -1.
export async function run(cmd: string, args: string[], opts: { timeoutMs?: number } = {}): Promise<RunResult | null> {
  // `claude` se busca también fuera del PATH (apps lanzadas desde el menú no heredan el del shell).
  const resolved = cmd === "claude" ? await findClaude(process.env, process.platform, homedir()) : which(cmd);
  if (!resolved) return null;
  const env = cmd === "claude" ? claudeSpawnEnv(process.env, resolved, process.platform) : undefined;
  const proc = Bun.spawn(spawnArgv(resolved, args, process.platform), { stdout: "pipe", stderr: "pipe", stdin: "ignore", env: env as Record<string, string> | undefined });
  const timer = setTimeout(() => proc.kill(), opts.timeoutMs ?? 30_000);
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(timer);
  return { code: proc.signalCode ? -1 : code, stdout, stderr };
}
