// Bus de eventos entre módulos (p. ej. requests emite "request.closed" y files lo escucha).
// Los módulos se comunican por aquí en vez de importarse entre sí.
type Listener = (payload: never) => void;

export class Bus {
  private listeners = new Map<string, Set<Listener>>();

  constructor(private onError: (event: string, e: unknown) => void = (ev, e) => console.error(`[bus] ${ev}`, e)) {}

  on<T>(event: string, fn: (payload: T) => void): () => void {
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, (set = new Set()));
    set.add(fn as Listener);
    return () => set.delete(fn as Listener);
  }

  emit<T>(event: string, payload: T): void {
    for (const fn of this.listeners.get(event) ?? []) {
      try {
        (fn as (p: T) => void)(payload);
      } catch (e) {
        this.onError(event, e);
      }
    }
  }
}
