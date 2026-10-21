// Reloj compartido para textos relativos ("Caduca en N min"). Uno por app: un solo intervalo
// para todas las tarjetas, en vez de un temporizador por tarjeta.
export const CLOCK_TICK_MS = 30_000;

export class Clock {
  now = $state(Date.now());
  private timer: ReturnType<typeof setInterval> | null = null;

  // Devuelve la función que lo para. Llamarlo dos veces no crea un segundo intervalo.
  start(): () => void {
    this.now = Date.now();
    if (!this.timer) this.timer = setInterval(() => (this.now = Date.now()), CLOCK_TICK_MS);
    return () => this.stop();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
