import type { DeviClient } from "@devi/client";
import type { SessionDelivery } from "@devi/protocol";
import { backoffDelayMs } from "./backoff";

export type SessionLoopOptions = {
  client: DeviClient;
  register: { name: string; cwd: string; parentPid: number };
  onSession: (id: string | null) => void;
  onDelivery: (d: SessionDelivery) => void;
  log: (...a: unknown[]) => void;
  sleep?: (ms: number) => Promise<void>;
};

// Registra la sesión y escucha sus entregas. Si el stream se cae, vuelve a registrarse
// (el servidor puede haberse reiniciado) con espera exponencial hasta 30 s.
// Devuelve la función para pararlo.
export function startSessionLoop(opts: SessionLoopOptions): () => void {
  const sleep = opts.sleep ?? ((ms) => Bun.sleep(ms));
  let stopped = false;
  let unsubscribe: (() => void) | null = null;
  let wake: (() => void) | null = null;
  let fatal = false;

  async function streamUntilBroken(id: string): Promise<void> {
    await new Promise<void>((resolve) => {
      wake = resolve;
      unsubscribe = opts.client.subscribeSession(id, opts.onDelivery, {
        onStatus: (s, err) => {
          if (s === "failed") {
            // 401/403/426: reintentar no lo arregla; se avisa y se deja de intentar
            fatal = true;
            opts.log(`el servidor de Devi rechazó la conexión de la sesión: ${err?.message ?? "error desconocido"}. Se deja de reintentar.`);
          }
          if (s === "reconnecting" || s === "failed") resolve();
        },
      });
    });
    unsubscribe?.();
    unsubscribe = null;
  }

  (async () => {
    let attempt = 0;
    while (!stopped) {
      try {
        const session = await opts.client.call("registerSession", { body: opts.register });
        attempt = 0;
        opts.onSession(session.id);
        opts.log(`sesión registrada: ${session.name} (${session.id})`);
        await streamUntilBroken(session.id);
        if (fatal) {
          opts.onSession(null);
          return;
        }
        if (!stopped) opts.log("se perdió la conexión con el servidor, reconectando…");
      } catch (e) {
        opts.log(`no se pudo registrar la sesión: ${(e as Error).message}`);
      }
      opts.onSession(null);
      if (stopped) return;
      await sleep(backoffDelayMs(attempt++));
    }
  })();

  return () => {
    stopped = true;
    unsubscribe?.();
    wake?.();
  };
}
