import type { DeviModule } from "../../core/module";
import { registerSettingsRoutes } from "./routes";
import { SettingsManager } from "./service";
import { SettingsStore, settingsMigrations } from "./store";

// Ajustes del servidor (pestaña Servidor): timeout de solicitudes, caducidad de borradores y retención.
// Ofrece el servicio "settings" a los demás módulos.
export const settingsModule: DeviModule = {
  name: "settings",
  migrations: settingsMigrations,
  routes(r, ctx) {
    const settings = new SettingsManager(new SettingsStore(ctx.db), ctx.db);
    ctx.services.provide("settings", settings);
    registerSettingsRoutes(r, ctx, settings);
  },
};
