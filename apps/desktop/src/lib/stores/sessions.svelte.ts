import type { Session } from "@devi/protocol";
import { type DeviApi, errorMessage } from "../api";

export function sortSessions(list: Session[], preferredId?: string): Session[] {
  return [...list].sort(
    (a, b) => Number(b.id === preferredId) - Number(a.id === preferredId) || a.name.localeCompare(b.name),
  );
}

// Sesiones vivas de Claude Code de la persona de esta app (selector "Enviar a sesión").
export class SessionsStore {
  list = $state<Session[]>([]);
  loading = $state(false);
  error = $state<string | null>(null);

  private seq = 0;

  // Varias cargas a la vez (dos tarjetas, o recargar tras un fallo): solo la última escribe
  // y `loading` sigue activo hasta que esa termina.
  async load(api: Pick<DeviApi, "memberSessions">, memberId: string): Promise<void> {
    const mine = ++this.seq;
    this.loading = true;
    this.error = null;
    try {
      const list = await api.memberSessions(memberId);
      if (mine === this.seq) this.list = list;
    } catch (e) {
      if (mine === this.seq) this.error = errorMessage(e);
    } finally {
      if (mine === this.seq) this.loading = false;
    }
  }
}
