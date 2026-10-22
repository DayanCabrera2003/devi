import { DeviApiError, type DeviClient } from "@devi/client";
import type { RegisterSessionBody, Session, SessionDelivery } from "@devi/protocol";
import type { z } from "zod";
import { backoffDelayMs } from "./backoff";

export type SessionLoopOptions = {
  client: DeviClient;
  register: z.input<typeof RegisterSessionBody>;
  // La sesión registrada (con el nombre definitivo que eligió el servidor: "api (2)"…) o null si se perdió.
  onSession: (session: Session | null) => void;
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
        opts.onSession(session);
        opts.log(`sesión registrada: ${session.name} (${session.id})`);
        await streamUntilBroken(session.id);
        if (fatal) {
          opts.onSession(null);
          return;
        }
        if (!stopped) opts.log("se perdió la conexión con el servidor, reconectando…");
      } catch (e) {
        if (e instanceof DeviApiError && e.body.code === "session_replaced") {
          // Claude Code relanzó su MCP y el nuevo ocupa ya esta sesión: este proceso sobra.
          opts.log("otro MCP de Devi del mismo Claude Code sustituyó a este. Se deja de reintentar.");
          opts.onSession(null);
          return;
        }
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
