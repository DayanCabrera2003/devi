// Temporizadores inyectables. En producción, RealTimers; en tests, FakeClock, que avanza el tiempo
// a mano (sin esperas reales). Todos devuelven una función para cancelar.
export type Cancel = () => void;

export interface Timers {
  after(ms: number, fn: () => void): Cancel;
  every(ms: number, fn: () => void): Cancel;
  stopAll(): void;
}

// setTimeout no admite más de ~24,8 días: se recorta y quien programa vuelve a comprobar al despertar.
const MAX_DELAY = 2_147_483_647;

export class RealTimers implements Timers {
  private active = new Set<Cancel>();

  after(ms: number, fn: () => void): Cancel {
    const h = setTimeout(() => {
      this.active.delete(cancel);
      fn();
    }, Math.min(Math.max(0, ms), MAX_DELAY));
    const cancel: Cancel = () => {
      clearTimeout(h);
      this.active.delete(cancel);
    };
    this.active.add(cancel);
    return cancel;
  }

  every(ms: number, fn: () => void): Cancel {
    const h = setInterval(fn, ms);
    const cancel: Cancel = () => {
      clearInterval(h);
      this.active.delete(cancel);
    };
    this.active.add(cancel);
    return cancel;
  }

  stopAll(): void {
    for (const cancel of [...this.active]) cancel();
  }
}

type FakeTimer = { id: number; at: number; every: number | null; fn: () => void };

export class FakeClock implements Timers {
  private timers = new Map<number, FakeTimer>();
  private seq = 0;

  constructor(private t = 1_700_000_000_000) {}

  now = (): number => this.t;

  after(ms: number, fn: () => void): Cancel {
    return this.add(this.t + Math.max(0, ms), null, fn);
  }

  every(ms: number, fn: () => void): Cancel {
    return this.add(this.t + ms, ms, fn);
  }

  stopAll(): void {
    this.timers.clear();
  }

  pending(): number {
    return this.timers.size;
  }

  // Avanza el reloj y ejecuta, en orden, los temporizadores que venzan por el camino.
  advance(ms: number): void {
    const target = this.t + ms;
    for (;;) {
      let next: FakeTimer | undefined;
      for (const tm of this.timers.values()) {
        if (tm.at > target) continue;
        if (!next || tm.at < next.at || (tm.at === next.at && tm.id < next.id)) next = tm;
      }
      if (!next) break;
      this.t = next.at;
      if (next.every === null) this.timers.delete(next.id);
      else next.at += next.every;
      next.fn();
    }
    this.t = target;
  }

  private add(at: number, every: number | null, fn: () => void): Cancel {
    const id = ++this.seq;
    this.timers.set(id, { id, at, every, fn });
    return () => {
      this.timers.delete(id);
    };
  }
}
