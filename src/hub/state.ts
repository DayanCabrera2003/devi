import type { Session, SessionStatus } from "../shared/types";

// Estado en memoria del hub. Sin I/O: el servidor decide qué empujar por SSE.
export class DeviState {
  sessions = new Map<string, Session>();

  addSession(user: string, name: string): Session {
    // Un nombre de sesión es único por usuario: si se re-registra, reemplaza a la anterior.
    for (const s of this.sessions.values()) {
      if (s.user === user && s.name === name) this.sessions.delete(s.id);
    }
    const session: Session = { id: crypto.randomUUID(), user, name, status: "idle" };
    this.sessions.set(session.id, session);
    return session;
  }

  removeSession(id: string) {
    this.sessions.delete(id);
  }

  sessionsOf(user: string): Session[] {
    return [...this.sessions.values()].filter((s) => s.user === user);
  }

  setStatus(user: string, name: string, status: SessionStatus): Session | undefined {
    const s = this.sessionsOf(user).find((s) => s.name === name);
    if (s) s.status = status;
    return s;
  }
}
