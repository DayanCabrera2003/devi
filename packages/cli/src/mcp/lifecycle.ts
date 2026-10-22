// Fin del proceso `devi mcp`. Claude Code cierra stdin al terminar la sesión (y a veces manda una señal):
// en cualquiera de los casos se limpia UNA sola vez (cerrar la sesión en el servidor) y se sale.
export const SHUTDOWN_SIGNALS = ["SIGTERM", "SIGINT", "SIGHUP"] as const;
export const SHUTDOWN_GRACE_MS = 1500;

type Emitter = { on(event: string, listener: () => void): unknown };

export function onShutdown(
  io: { stdin: Emitter; proc: Emitter },
  cleanup: (reason: string) => Promise<void>,
  exit: (code: number) => void = (code) => process.exit(code),
  graceMs = SHUTDOWN_GRACE_MS,
): (reason: string) => void {
  let done = false;
  const run = (reason: string) => {
    if (done) return;
    done = true;
    // Si la limpieza se cuelga (servidor caído), se sale igualmente tras el plazo.
    const timer = setTimeout(() => exit(0), graceMs);
    cleanup(reason)
      .catch(() => {})
      .finally(() => {
        clearTimeout(timer);
        exit(0);
      });
  };
  io.stdin.on("end", () => run("stdin"));
  io.stdin.on("close", () => run("stdin"));
  for (const sig of SHUTDOWN_SIGNALS) io.proc.on(sig, () => run(sig));
  return run; // para otros avisos de cierre (el transporte MCP se cerró)
}
