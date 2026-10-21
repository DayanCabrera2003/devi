// Guardas del último admin: el servidor rechaza con 409 last_admin cualquier cambio que deje a
// Devi sin nadie con team.admin; la UI desactiva antes esos controles. Funciones puras.
import type { Member, Role } from "@devi/protocol";

type MemberLike = Pick<Member, "id" | "roleIds" | "disabled">;
type RoleLike = Pick<Role, "id" | "perms">;
export type TeamLike = { members: MemberLike[]; roles: RoleLike[] };

export const LAST_ADMIN_HINT = "Tiene que quedar al menos un admin";

// Personas activas con team.admin a través de alguno de sus roles.
export function activeAdminCount(team: TeamLike): number {
  const adminRoles = new Set(team.roles.filter((r) => r.perms.includes("team.admin")).map((r) => r.id));
  return team.members.filter((m) => !m.disabled && m.roleIds.some((id) => adminRoles.has(id))).length;
}

// Solo se bloquea lo que pasaría de tener algún admin a no tener ninguno.
function keepsAnAdmin(before: TeamLike, after: TeamLike): boolean {
  return activeAdminCount(before) === 0 || activeAdminCount(after) > 0;
}

// roleIds: los roles que el formulario tiene marcados ahora para esa persona.
export function canDropMemberRole(team: TeamLike, memberId: string, roleIds: string[], roleId: string): boolean {
  const withRoles = (ids: string[]) => ({
    ...team,
    members: team.members.map((m) => (m.id === memberId ? { ...m, roleIds: ids } : m)),
  });
  return keepsAnAdmin(
    withRoles(roleIds),
    withRoles(roleIds.filter((r) => r !== roleId)),
  );
}

export function canDisableMember(team: TeamLike, memberId: string): boolean {
  return keepsAnAdmin(team, {
    ...team,
    members: team.members.map((m) => (m.id === memberId ? { ...m, disabled: true } : m)),
  });
}

export function canRevokeAdminFromRole(team: TeamLike, roleId: string): boolean {
  return keepsAnAdmin(team, {
    ...team,
    roles: team.roles.map((r) => (r.id === roleId ? { ...r, perms: r.perms.filter((p) => p !== "team.admin") } : r)),
  });
}

export function canDeleteRole(team: TeamLike, roleId: string): boolean {
  return keepsAnAdmin(team, { ...team, roles: team.roles.filter((r) => r.id !== roleId) });
}
