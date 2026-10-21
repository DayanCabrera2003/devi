// Bus de eventos entre módulos (p. ej. requests emite "request.closed" y files lo escucha).
// Los módulos se comunican por aquí en vez de importarse entre sí.
//
// Los eventos están tipados. El núcleo no conoce ninguno: cada módulo declara los suyos
// ampliando esta interfaz (declaration merging), sin tocar el núcleo:
//
//   declare module "../../core/bus" {
//     interface BusEvents { "request.closed": { requestId: string } }
//   }
//
export interface BusEvents {}

type Listener = (payload: never) => void;

export class Bus {
  private listeners = new Map<string, Set<Listener>>();

  constructor(private onError: (event: string, e: unknown) => void = (ev, e) => console.error(`[bus] ${ev}`, e)) {}

  on<K extends keyof BusEvents>(event: K, fn: (payload: BusEvents[K]) => void): () => void {
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, (set = new Set()));
    set.add(fn as Listener);
    return () => set.delete(fn as Listener);
  }

  emit<K extends keyof BusEvents>(event: K, payload: BusEvents[K]): void {
    for (const fn of this.listeners.get(event) ?? []) {
      try {
        (fn as (p: BusEvents[K]) => void)(payload);
      } catch (e) {
        this.onError(event, e);
      }
    }
  }
}
