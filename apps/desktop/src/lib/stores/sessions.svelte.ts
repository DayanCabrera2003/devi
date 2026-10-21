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

  async load(api: Pick<DeviApi, "memberSessions">, memberId: string): Promise<void> {
    this.loading = true;
    this.error = null;
    try {
      this.list = await api.memberSessions(memberId);
    } catch (e) {
      this.error = errorMessage(e);
    } finally {
      this.loading = false;
    }
  }
}
