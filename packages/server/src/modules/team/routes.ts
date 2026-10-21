import { API, type Member, type Role } from "@devi/protocol";
import { readBody } from "../../core/body";
import { json } from "../../core/http";
import type { ModuleContext } from "../../core/module";
import { userKey } from "../../core/push";
import type { RequestContext, Router } from "../../core/router";
import type { AuditInput } from "../../core/services";
import type { TeamManager } from "./service";

const ok = () => json({ ok: true });

const MEMBER_FIELDS = ["login", "name", "description", "roleIds", "disabled"] as const;
const ROLE_FIELDS = ["name", "color", "capabilities", "perms"] as const;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// Qué campos cambiaron: { fields: "name,roleIds", changes: {"name": [antes, después], …} }.
function diff<T extends object>(before: T, after: T, keys: readonly (keyof T & string)[]) {
  const fields = keys.filter((k) => !same(before[k], after[k]));
  return { fields, changes: Object.fromEntries(fields.map((k) => [k, [before[k], after[k]]])) };
}

export function registerTeamRoutes(r: Router, ctx: ModuleContext, team: TeamManager): void {
  // Conectado = app abierta y viva, o alguna sesión de Claude Code viva.
  const isConnected = (memberId: string) =>
    ctx.presence.isAlive(userKey(memberId)) || (ctx.services.find("sessions")?.hasLive(memberId) ?? false);

  r.on(API.me, ({ principal, access }) => json(team.me(principal.login, access.memberId)));
  r.on(API.team, () => json(team.view(isConnected)));

  const audit = (rc: RequestContext, input: Omit<AuditInput, "actorMemberId" | "actorLogin">) =>
    ctx.services.find("audit")?.record({ ...input, actorMemberId: rc.access.memberId, actorLogin: rc.principal.login });

  r.on(API.createMember, async (rc) => {
    const m = team.createMember(await readBody(rc.request, API.createMember.body));
    audit(rc, {
      action: "member.created", targetType: "member", targetId: m.id,
      details: { login: m.login, name: m.name, roleIds: JSON.stringify(m.roleIds), isAdmin: team.adminIds().includes(m.id) },
    });
    return json(m);
  });
  r.on(API.updateMember, async (rc) => {
    const id = rc.params.id!;
    const before = team.getMember(id);
    const wasAdmin = team.adminIds().includes(id);
    const after = team.updateMember(id, await readBody(rc.request, API.updateMember.body));
    const { fields, changes } = diff<Member>(before ?? after, after, MEMBER_FIELDS);
    if (fields.length > 0) {
      const becameAdmin = !wasAdmin && team.adminIds().includes(id);
      const disabled = !before?.disabled && after.disabled;
      audit(rc, {
        action: disabled ? "member.disabled" : "member.updated", targetType: "member", targetId: id,
        details: { login: after.login, fields: fields.join(","), changes: JSON.stringify(changes), becameAdmin: becameAdmin || undefined },
        // Roles cambiados = permisos cambiados: se avisa a los admins.
        alert: disabled || fields.includes("roleIds") ? true : undefined,
      });
    }
    return json(after);
  });
  r.on(API.deleteMember, (rc) => {
    const before = team.getMember(rc.params.id!);
    team.deleteMember(rc.params.id!);
    audit(rc, { action: "member.deleted", targetType: "member", targetId: rc.params.id!, details: { login: before?.login, name: before?.name } });
    return ok();
  });

  r.on(API.createRole, async (rc) => {
    const role = team.createRole(await readBody(rc.request, API.createRole.body));
    audit(rc, {
      action: "role.created", targetType: "role", targetId: role.id,
      details: { name: role.name, perms: JSON.stringify(role.perms), capabilities: JSON.stringify(role.capabilities) },
    });
    return json(role);
  });
  r.on(API.updateRole, async (rc) => {
    const id = rc.params.id!;
    const before = team.getRole(id);
    const after = team.updateRole(id, await readBody(rc.request, API.updateRole.body));
    const { fields, changes } = diff<Role>(before ?? after, after, ROLE_FIELDS);
    audit(rc, {
      action: "role.updated", targetType: "role", targetId: id,
      details: {
        name: after.name, fields: fields.join(","), changes: JSON.stringify(changes),
        permsBefore: JSON.stringify(before?.perms ?? []), permsAfter: JSON.stringify(after.perms),
      },
    });
    return json(after);
  });
  r.on(API.deleteRole, (rc) => {
    const before = team.getRole(rc.params.id!);
    team.deleteRole(rc.params.id!);
    audit(rc, {
      action: "role.deleted", targetType: "role", targetId: rc.params.id!,
      details: { name: before?.name, perms: JSON.stringify(before?.perms ?? []) },
    });
    return ok();
  });
}
