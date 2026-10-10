import type { DeviRequest, Session, SessionStatus } from "../shared/types";

// Error de transición: el servidor lo traduce a un código HTTP.
export class TransitionError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// Estado en memoria del hub. Sin I/O: el servidor decide qué empujar por SSE.
export class DeviState {
  sessions = new Map<string, Session>();
  requests = new Map<string, DeviRequest>();

  constructor(public timeoutMs = 3_600_000) {}

  // ---- sesiones -------------------------------------------------------------

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

  // ---- solicitudes ----------------------------------------------------------

  get(id: string): DeviRequest {
    const r = this.requests.get(id);
    if (!r) throw new TransitionError(404, "solicitud desconocida");
    return r;
  }

  createRequest(
    input: { from: string; fromSessionId: string; to: string; message: string },
    now = Date.now(),
  ): DeviRequest {
    const session = this.sessions.get(input.fromSessionId);
    if (!session || session.user !== input.from) {
      throw new TransitionError(400, "la sesión de origen no existe o no es tuya");
    }
    if (input.to === input.from) throw new TransitionError(400, "no puedes enviarte una solicitud a ti mismo");
    if (!input.message.trim()) throw new TransitionError(400, "el mensaje está vacío");
    const req: DeviRequest = {
      id: crypto.randomUUID().slice(0, 8),
      from: input.from,
      fromSessionId: session.id,
      fromSessionName: session.name,
      to: input.to,
      message: input.message.trim(),
      status: "pending",
      createdAt: now,
      deadline: now + this.timeoutMs,
    };
    this.requests.set(req.id, req);
    return req;
  }

  // B elige una de sus sesiones para que la solicitud llegue como pregunta abierta.
  forward(id: string, sessionId: string): { req: DeviRequest; session: Session } {
    const req = this.get(id);
    if (req.status !== "pending") throw new TransitionError(409, `la solicitud ya está ${req.status}`);
    const session = this.sessions.get(sessionId);
    if (!session || session.user !== req.to) {
      throw new TransitionError(409, "esa sesión ya no está abierta");
    }
    req.status = "forwarded";
    req.forwardedSessionId = session.id;
    return { req, session };
  }
}
