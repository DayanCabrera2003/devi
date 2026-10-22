import type { DeviModule } from "../../core/module";
import { registerPrefsRoutes } from "./routes";
import { PrefsManager } from "./service";
import { PrefsStore, prefsMigrations } from "./store";

// Preferencias de cada persona (Ajustes de la app), p. ej. si quiere avisos de solicitudes en sus sesiones de
// Claude Code. Ofrece el servicio "prefs" a los demás módulos.
export const prefsModule: DeviModule = {
  name: "prefs",
  migrations: prefsMigrations,
  routes(r, ctx) {
    const prefs = new PrefsManager(new PrefsStore(ctx.db), ctx.db);
    ctx.services.provide("prefs", prefs);
    registerPrefsRoutes(r, prefs);
  },
};
