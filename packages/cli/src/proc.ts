// Ejecutar programas externos (claude, tailscale) sin shell y de forma portable.
export type RunResult = { code: number; stdout: string; stderr: string };

// En Windows, `claude` instalado con npm es un .cmd: hay que pasar por cmd.exe.
export function spawnArgv(resolved: string, args: string[], platform: NodeJS.Platform): string[] {
  if (platform === "win32" && /\.(cmd|bat)$/i.test(resolved)) {
    const quote = (a: string) => (/[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a);
    return ["cmd.exe", "/d", "/s", "/c", [resolved, ...args].map(quote).join(" ")];
  }
  return [resolved, ...args];
}

export function which(cmd: string): string | null {
  return Bun.which(cmd);
}

// Devuelve null si el programa no está en el PATH. Nunca lanza por timeout: mata el proceso y devuelve code -1.
export async function run(cmd: string, args: string[], opts: { timeoutMs?: number } = {}): Promise<RunResult | null> {
  const resolved = which(cmd);
  if (!resolved) return null;
  const proc = Bun.spawn(spawnArgv(resolved, args, process.platform), { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const timer = setTimeout(() => proc.kill(), opts.timeoutMs ?? 30_000);
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(timer);
  return { code: proc.signalCode ? -1 : code, stdout, stderr };
}
