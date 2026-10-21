import type { DeviModule, ModuleContext } from "../../core/module";
import { pushUser, sessionKey } from "../../core/push";
import { registerSessionRoutes } from "./routes";
import { SessionManager } from "./service";
import { SessionsStore, sessionsMigrations } from "./store";

// Una sesión se cerró, fue sustituida o dejó de estar viva. Lo escucha requests.
declare module "../../core/bus" {
  interface BusEvents {
    "session.closed": { sessionId: string };
  }
}

const HOUR = 3_600_000;
const managers = new WeakMap<ModuleContext, SessionManager>();

// Sesiones de Claude Code (las registra el MCP), su estado (hooks) y su presencia (SSE + latidos).
// Ofrece el servicio "sessions".
export const sessionsModule: DeviModule = {
  name: "sessions",
  migrations: sessionsMigrations,

  routes(r, ctx) {
    const changed = (memberId: string) => pushUser(ctx.sse, memberId, { type: "sessions.updated", memberId });
    const sessions = new SessionManager(new SessionsStore(ctx.db), ctx.presence, ctx.now, changed, (sessionId) => {
      ctx.sse.close(sessionKey(sessionId));
      ctx.bus.emit("session.closed", { sessionId });
    });
    managers.set(ctx, sessions);
    ctx.services.provide("sessions", sessions);
    ctx.bus.on("presence.changed", ({ key, alive }) => {
      if (!key.startsWith("session:")) return;
      const sessionId = key.slice("session:".length);
      const memberId = sessions.memberOf(sessionId);
      if (memberId) changed(memberId);
      if (!alive) ctx.bus.emit("session.closed", { sessionId });
    });
    registerSessionRoutes(r, ctx, sessions);
  },

  onStart(ctx) {
    const sessions = managers.get(ctx)!;
    sessions.prune();
    ctx.timers.every(HOUR, () => sessions.prune());
  },
};
