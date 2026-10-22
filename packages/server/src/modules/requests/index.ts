import type { DeviModule, ModuleContext } from "../../core/module";
import { registerAppRoutes } from "./app-routes";
import { Conversations } from "./conversations";
import { PendingReads } from "./pending";
import { registerRequestRoutes } from "./routes";
import { RequestsManager } from "./service";
import { RequestsStore, requestsMigrations } from "./store";

// Eventos internos que emite este módulo (files los escucha para la retención).
declare module "../../core/bus" {
  interface BusEvents {
    "draft.discarded": { draftId: string };
    "request.closed": { requestId: string };
    "session.closed": { sessionId: string };
  }
}

const managers = new WeakMap<ModuleContext, RequestsManager>();

// Borradores y solicitudes: estados, autorizaciones, plazos, entregas a sesiones y SSE de la app.
// Usa los servicios team, sessions, files y settings.
export const requestsModule: DeviModule = {
  name: "requests",
  migrations: requestsMigrations,

  routes(r, ctx) {
    const store = new RequestsStore(ctx.db, ctx.now);
    const requests = new RequestsManager(store, ctx);
    managers.set(ctx, requests);
    ctx.bus.on("session.closed", ({ sessionId }) => requests.onSessionClosed(sessionId));
    registerRequestRoutes(r, ctx, requests);
    const view = (x: Parameters<RequestsManager["viewOf"]>[0]) => requests.viewOf(x);
    registerAppRoutes(r, ctx, requests, new Conversations(store, ctx, view), new PendingReads(store, view, (d) => requests.draftViewOf(d)));
  },

  onStart(ctx) {
    managers.get(ctx)!.restore();
  },
};
