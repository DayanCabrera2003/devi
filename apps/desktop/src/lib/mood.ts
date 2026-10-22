// Humor de Devi según el estado de la app. Funciones puras: DeviApp las alimenta y la mascota lo pinta.
import type { Card } from "./stores/inbox.svelte";

// calm = en reposo (parpadea); offline = gris sin conexión.
export type Mood = "calm" | "sleeping" | "attentive" | "uneasy" | "happy" | "offline";

// Cuánto dura la alegría al llegar una respuesta.
export const HAPPY_MS = 4_000;
// Sin pendientes ni actividad durante este rato, Devi se duerme.
export const SLEEP_AFTER_MS = 10 * 60_000;

export type MoodInput = {
  online: boolean;
  pending: number; // tarjetas abiertas
  overdue: number; // ver overdueCount
  cheering: boolean; // acaba de llegar una respuesta (dura HAPPY_MS)
  quietSince: number | null; // desde cuándo no hay pendientes ni actividad (null = hay pendientes)
  now: number;
};

// Orden de prioridad: sin conexión, contenta (es solo un momento), inquieta, atenta, dormida y en reposo.
export function deriveMood(s: MoodInput): Mood {
  if (!s.online) return "offline";
  if (s.cheering) return "happy";
  if (s.overdue > 0) return "uneasy";
  if (s.pending > 0) return "attentive";
  if (s.quietSince !== null && s.now - s.quietSince >= SLEEP_AFTER_MS) return "sleeping";
  return "calm";
}

// Lo que venció: solicitudes mías que caducaron sin respuesta y las que me piden con el plazo ya pasado.
export function overdueCount(cards: readonly Card[], now: number): number {
  let n = 0;
  for (const c of cards) {
    if (c.kind === "timeout" || (c.kind === "request" && c.request.deadline <= now)) n++;
  }
  return n;
}

// Nuevo valor de quietSince: con pendientes no hay calma; sin ellos se cuenta desde que se quedó sin
// pendientes o desde la última actividad (un evento del servidor o una acción en la app).
export function quietSinceAfter(prev: number | null, pending: number, now: number, activity: boolean): number | null {
  if (pending > 0) return null;
  if (activity || prev === null) return now;
  return prev;
}
