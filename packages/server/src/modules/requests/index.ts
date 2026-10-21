import type { DeviModule, ModuleContext } from "../../core/module";
import { registerRequestRoutes } from "./routes";
import { RequestsManager } from "./service";
import { RequestsStore, requestsMigrations } from "./store";

// Eventos internos que emite este módulo (files los escucha para la retención).
declare module "../../core/bus" {
  interface BusEvents {
    "draft.discarded": { draftId: string };
    "request.closed": { requestId: string };
  }
}

const managers = new WeakMap<ModuleContext, RequestsManager>();

// Borradores y solicitudes: estados, autorizaciones, plazos, entregas a sesiones y SSE de la app.
// Usa los servicios team, sessions, files y settings.
export const requestsModule: DeviModule = {
  name: "requests",
  migrations: requestsMigrations,

  routes(r, ctx) {
    const requests = new RequestsManager(new RequestsStore(ctx.db), ctx);
    managers.set(ctx, requests);
    registerRequestRoutes(r, ctx, requests);
  },

  onStart(ctx) {
    managers.get(ctx)!.restore();
  },
};
