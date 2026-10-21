import type { Cancel, Timers } from "../../core/clock";

// Un temporizador por clave ("draft:<id>", "request:<id>"): programar de nuevo sustituye al anterior.
export class KeyedTimers {
  private map = new Map<string, Cancel>();

  constructor(
    private timers: Timers,
    private now: () => number,
  ) {}

  at(key: string, when: number, fn: () => void): void {
    this.cancel(key);
    this.map.set(
      key,
      this.timers.after(Math.max(0, when - this.now()), () => {
        this.map.delete(key);
        fn();
      }),
    );
  }

  cancel(key: string): void {
    this.map.get(key)?.();
    this.map.delete(key);
  }

  has(key: string): boolean {
    return this.map.has(key);
  }
}
