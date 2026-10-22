import { WEEK_MS, WEEK_TOP, type Week } from "@devi/protocol";
import type { RequestsStore } from "./store";

// «Tu semana»: el resumen de los últimos 7 días de quien llama. Solo lee sus propias solicitudes.
export class WeekReads {
  constructor(
    private store: RequestsStore,
    private now: () => number,
  ) {}

  of(me: string): Week {
    const to = this.now();
    const from = to - WEEK_MS;
    // La ventana incluye el instante actual: lo que acaba de pasar también cuenta.
    const c = this.store.weekCounts(me, from, to + 1);
    return {
      from,
      to,
      sent: c.sent,
      received: c.received,
      answered: c.answered,
      avgResponseMs: c.avgResponseMs === null ? null : Math.round(c.avgResponseMs),
      topHelped: this.store.weekHelped(me, from, to + 1, WEEK_TOP),
    };
  }
}
