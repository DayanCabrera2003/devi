import { API } from "@devi/protocol";
import { readBody } from "../../core/body";
import { json } from "../../core/http";
import type { ModuleContext } from "../../core/module";
import { userKey } from "../../core/push";
import type { Router } from "../../core/router";
import type { TeamManager } from "./service";

const ok = () => json({ ok: true });

export function registerTeamRoutes(r: Router, ctx: ModuleContext, team: TeamManager): void {
  // Conectado = app abierta y viva, o alguna sesión de Claude Code viva.
  const isConnected = (memberId: string) =>
    ctx.presence.isAlive(userKey(memberId)) || (ctx.services.find("sessions")?.hasLive(memberId) ?? false);

  r.on(API.me, ({ principal, access }) => json(team.me(principal.login, access.memberId)));
  r.on(API.team, () => json(team.view(isConnected)));

  r.on(API.createMember, async ({ request }) => json(team.createMember(await readBody(request, API.createMember.body))));
  r.on(API.updateMember, async ({ request, params }) =>
    json(team.updateMember(params.id!, await readBody(request, API.updateMember.body))),
  );
  r.on(API.deleteMember, ({ params }) => {
    team.deleteMember(params.id!);
    return ok();
  });

  r.on(API.createRole, async ({ request }) => json(team.createRole(await readBody(request, API.createRole.body))));
  r.on(API.updateRole, async ({ request, params }) =>
    json(team.updateRole(params.id!, await readBody(request, API.updateRole.body))),
  );
  r.on(API.deleteRole, ({ params }) => {
    team.deleteRole(params.id!);
    return ok();
  });
}
