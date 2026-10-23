import type { DeviModule, ModuleContext } from "../../core/module";
import { registerClaimRoutes } from "./routes";
import { ClaimsManager } from "./service";
import { ClaimsStore, claimsMigrations } from "./store";

// Cada cuánto se avisa a la app de los códigos caducados: con 10 min de vida, 15 s de retraso en el aviso no se notan.
const SWEEP_MS = 15_000;

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
    ctx.timers.every(SWEEP_MS, () => claims.sweep());
  },
};
