import type { DeviModule, ModuleContext } from "../../core/module";
import { pushUser } from "../../core/push";
import { readLegacyTeam } from "./legacy";
import { registerTeamRoutes } from "./routes";
import { TeamManager } from "./service";
import { TeamStore, teamMigrations } from "./store";

// Personas, roles y permisos. Decide quién es del equipo (resolver de acceso), ofrece el servicio
// "team" y, al arrancar, importa team.json (--import) y exige un admin (--admin).
const managers = new WeakMap<ModuleContext, TeamManager>();

export const teamModule: DeviModule = {
  name: "team",
  migrations: teamMigrations,

  routes(r, ctx) {
    // team.updated a todas las apps abiertas: cambió el equipo o quién está conectado.
    const broadcast = () => {
      for (const id of team.memberIds()) pushUser(ctx.sse, id, { type: "team.updated" });
    };
    const team = new TeamManager(new TeamStore(ctx.db), ctx.db, ctx.now, broadcast);
    managers.set(ctx, team);
    ctx.services.provide("team", team);
    ctx.setAccessResolver((login) => team.resolveAccess(login));
    ctx.bus.on("presence.changed", broadcast);
    registerTeamRoutes(r, ctx, team);
  },

  async onStart(ctx) {
    const team = managers.get(ctx)!;
    if (ctx.config.importTeam) {
      const n = team.importLegacy(await readLegacyTeam(ctx.config.importTeam));
      ctx.log(`importadas ${n} personas de ${ctx.config.importTeam}. Su login es el id del team.json: cámbialo por su login de Tailscale en Admin → Personas`);
    }
    const outcome = team.ensureAdmin(ctx.config.adminLogin);
    if (ctx.config.adminLogin) {
      const what = { created: "creado como admin", granted: "ahora es admin", already_admin: "ya era admin (no se cambia nada)", admins_exist: "ya hay admins" }[outcome];
      ctx.log(`--admin ${ctx.config.adminLogin}: ${what}`);
    }
  },
};
