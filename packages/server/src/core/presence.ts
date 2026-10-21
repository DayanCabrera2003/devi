import { PRESENCE } from "@devi/protocol";
import type { Bus } from "./bus";
import type { SseHub } from "./sse";

declare module "./bus" {
  interface BusEvents {
    // Una clave SSE pasa a viva o deja de estarlo. Lo escuchan team (connected) y sessions.
    "presence.changed": { key: string; alive: boolean };
  }
}

// Presencia de claves SSE ("user:<id>", "session:<id>").
// Viva = stream abierto Y algún latido en los últimos staleMs. El stream solo no basta: si el cliente
// se cae sin cerrar la conexión, Bun.serve puede tardar en abortar el stream.
// Cada cambio (viva ↔ no viva) se anuncia una sola vez por el bus ("presence.changed").
export class Presence {
  private lastSeen = new Map<string, number>();
  private alive = new Set<string>();

  constructor(
    private sse: SseHub,
    private bus: Bus,
    private now: () => number,
    private staleMs: number = PRESENCE.staleMs,
  ) {}

  // Abre el SSE de la clave. Abrir cuenta como latido.
  open(key: string, signal: AbortSignal, hooks: { onOpen?: () => void; onClose?: () => void } = {}): Response {
    return this.sse.open(key, signal, {
      onOpen: () => {
        this.touch(key);
        hooks.onOpen?.();
      },
      onClose: () => {
        this.refresh(key);
        hooks.onClose?.();
      },
    });
  }

  touch(key: string): void {
    this.lastSeen.set(key, this.now());
    this.refresh(key);
  }

  isAlive(key: string): boolean {
    const seen = this.lastSeen.get(key);
    return seen !== undefined && this.sse.isOpen(key) && this.now() - seen <= this.staleMs;
  }

  lastSeenOf(key: string): number | undefined {
    return this.lastSeen.get(key);
  }

  // Olvida una clave (p. ej. una sesión cerrada).
  forget(key: string): void {
    this.lastSeen.delete(key);
    this.refresh(key);
  }

  // Revisión periódica (la programa createApp cada PRESENCE.sweepMs).
  sweep(): void {
    for (const key of [...this.alive]) this.refresh(key);
  }

  private refresh(key: string): void {
    const alive = this.isAlive(key);
    if (alive === this.alive.has(key)) return;
    if (alive) this.alive.add(key);
    else this.alive.delete(key);
    this.bus.emit("presence.changed", { key, alive });
  }
}
