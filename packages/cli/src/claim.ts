import { DeviApiError, type DeviClient } from "@devi/client";
import { type SessionDelivery, formatClaimCode } from "@devi/protocol";

// Canje de un código de entrega desde el hook UserPromptSubmit («devi: recibir K7Q-4MX» como primer mensaje).
// El MCP de una sesión recién abierta puede tardar en registrarse: mientras el servidor diga session_unknown,
// se reintenta dentro de un presupuesto que deja el resto del plazo del hook para la bandeja y los archivos.
export const CLAIM_REDEEM_BUDGET_MS = 2000;
const INTERVAL_MS = 500;

export type Pair = { claudeSessionId: string; parentPid: number; machine: string };
export type RedeemOutcome = { ok: true; delivery: SessionDelivery } | { ok: false; message: string; unreachable?: true };

// Sin respuesta (red, plazo agotado) no se sabe si el servidor llegó a canjearlo: el código puede estar ya gastado y
// la entrega en esta sesión, así que no se manda generar otro a ciegas.
export const CLAIM_UNREACHABLE_MESSAGE =
  "El servidor de Devi no respondió a tiempo: puede que la entrega ya esté en esta sesión. Revisa la app de Devi antes de generar otro código.";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// El presupuesto solo decide si cabe otro intento; el corte de una petición colgada es cosa del cliente
// (el hook le pasa una señal con este mismo plazo).
export async function redeemWithRetry(
  client: DeviClient,
  code: string,
  pair: Pair,
  o: { intervalMs?: number; budgetMs?: number } = {},
): Promise<RedeemOutcome> {
  const interval = o.intervalMs ?? INTERVAL_MS;
  const deadline = Date.now() + (o.budgetMs ?? CLAIM_REDEEM_BUDGET_MS);
  for (;;) {
    try {
      const r = await client.call("redeemClaim", { body: { code, ...pair } });
      return { ok: true, delivery: r.delivery };
    } catch (e) {
      if (!(e instanceof DeviApiError) || e.status === 0) return { ok: false, message: CLAIM_UNREACHABLE_MESSAGE, unreachable: true };
      if (e.body.code !== "session_unknown" || Date.now() + interval > deadline) return { ok: false, message: e.message };
      await sleep(interval);
    }
  }
}

// Nota para el agente cuando el código no sirvió. Solo texto propio de Devi y del servidor (nada de compañeros).
export function claimFailureNote(code: string, message: string, o: { unreachable?: boolean } = {}): string {
  return [
    `Devi: el usuario pegó el código de entrega ${formatClaimCode(code)}, pero no se pudo usar: ${message}`,
    o.unreachable
      ? "Díselo al usuario en una línea."
      : "Díselo al usuario en una línea. Si hace falta, que genere otro en la app de Devi («+ Sesión nueva») y lo pegue aquí.",
  ].join("\n");
}
