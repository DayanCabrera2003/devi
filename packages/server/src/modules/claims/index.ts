import { PRESENCE } from "@devi/protocol";
import type { DeviModule, ModuleContext } from "../../core/module";
import { registerClaimRoutes } from "./routes";
import { ClaimsManager } from "./service";
import { ClaimsStore, claimsMigrations } from "./store";

const managers = new WeakMap<ModuleContext, ClaimsManager>();

// Códigos de entrega: «+ Sesión nueva» en la app. Usa el servicio sessions (pair) y los manejadores que publican
// requests (requestTargets) y chat (chatTargets); no importa ninguno de los dos.
export const claimsModule: DeviModule = {
  name: "claims",
  migrations: claimsMigrations,

  routes(r, ctx) {
    const claims = new ClaimsManager(new ClaimsStore(ctx.db), ctx);
    managers.set(ctx, claims);
    registerClaimRoutes(r, claims);
  },

  onStart(ctx) {
    const claims = managers.get(ctx)!;
    claims.sweep();
    ctx.timers.every(PRESENCE.sweepMs, () => claims.sweep());
  },
};
