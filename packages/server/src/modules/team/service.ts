import type { Database } from "bun:sqlite";
import {
  PERMS,
  type CreateMemberBody,
  type CreateRoleBody,
  type Me,
  type Member,
  type Role,
  type TeamView,
  type UpdateMemberBody,
  type UpdateRoleBody,
} from "@devi/protocol";
import type { z } from "zod";
import type { Access } from "../../core/auth";
import { HttpError } from "../../core/http";
import type { MemberInfo, TeamService } from "../../core/services";
import type { TeamStore } from "./store";

export const ADMIN_ROLE_NAME = "Admin Devi";

type CreateMember = z.output<typeof CreateMemberBody>;
type UpdateMember = z.output<typeof UpdateMemberBody>;
type CreateRole = z.output<typeof CreateRoleBody>;
type UpdateRole = z.output<typeof UpdateRoleBody>;

// Forma del team.json del proof of concept (sin login).
export type LegacyMember = { id: string; name: string; role: string; description: string };

const LAST_ADMIN = () =>
  new HttpError(409, "No se puede dejar a Devi sin ningún admin: da antes el permiso team.admin a otra persona", {
    code: "last_admin",
  });

export class TeamManager implements TeamService {
  constructor(
    private store: TeamStore,
    private db: Database,
    private now: () => number,
    private changed: () => void, // avisa a las apps (team.updated)
  ) {}

  // ---- acceso ---------------------------------------------------------------

  // login → persona activa → permisos (unión de sus roles). Desconocido o desactivado → null (403).
  resolveAccess(login: string): Access | null {
    const m = this.store.memberByLogin(login);
    if (!m || m.disabled) return null;
    return { memberId: m.id, perms: new Set(this.store.permsOf(m.id)) };
  }

  me(login: string, memberId: string): Me {
    const member = this.memberOr404(memberId);
    const roles = member.roleIds.map((id) => this.store.role(id)).filter((r): r is Role => r !== null);
    return { login, member, roles, perms: this.store.permsOf(memberId) };
  }

  view(isConnected: (memberId: string) => boolean): TeamView {
    return {
      members: this.store.members().map((m) => ({ ...m, connected: !m.disabled && isConnected(m.id) })),
      roles: this.store.roles(),
    };
  }

  // ---- TeamService (para otros módulos) -------------------------------------

  member(id: string): MemberInfo | null {
    const m = this.store.member(id);
    return m ? { id: m.id, login: m.login, name: m.name, disabled: m.disabled } : null;
  }

  nameOf(id: string): string {
    return this.store.member(id)?.name ?? id;
  }

  memberIds(): string[] {
    return this.store.members().map((m) => m.id);
  }

  // ---- personas -------------------------------------------------------------

  createMember(body: CreateMember): Member {
    this.assertLoginFree(body.login);
    this.assertRolesExist(body.roleIds);
    const id = crypto.randomUUID();
    this.db.transaction(() => {
      this.store.insertMember({
        id, login: body.login, name: body.name, description: body.description, disabledAt: null, createdAt: this.now(),
      });
      this.store.setMemberRoles(id, body.roleIds);
    })();
    this.changed();
    return this.memberOr404(id);
  }

  // Solo cambia los campos enviados.
  updateMember(id: string, patch: UpdateMember): Member {
    const current = this.memberOr404(id);
    if (patch.login !== undefined && patch.login !== current.login) this.assertLoginFree(patch.login);
    if (patch.roleIds) this.assertRolesExist(patch.roleIds);
    this.guarded(() => {
      const disabledAt =
        patch.disabled === undefined ? (current.disabled ? this.disabledAtOf(id) : null) : patch.disabled ? this.now() : null;
      this.store.updateMember(id, {
        login: patch.login ?? current.login,
        name: patch.name ?? current.name,
        description: patch.description ?? current.description,
        disabledAt,
      });
      if (patch.roleIds) this.store.setMemberRoles(id, patch.roleIds);
    });
    this.changed();
    return this.memberOr404(id);
  }

  deleteMember(id: string): void {
    this.memberOr404(id);
    this.guarded(() => this.store.deleteMember(id));
    this.changed();
  }

  // ---- roles ----------------------------------------------------------------

  createRole(body: CreateRole): Role {
    this.assertRoleNameFree(body.name);
    const id = crypto.randomUUID();
    this.db.transaction(() => {
      this.store.insertRole({ id, name: body.name, color: body.color });
      this.store.setRoleCaps(id, body.capabilities);
      this.store.setRolePerms(id, body.perms);
    })();
    this.changed();
    return this.roleOr404(id);
  }

  updateRole(id: string, patch: UpdateRole): Role {
    const current = this.roleOr404(id);
    if (patch.name !== undefined && patch.name !== current.name) this.assertRoleNameFree(patch.name);
    this.guarded(() => {
      this.store.updateRole(id, { name: patch.name ?? current.name, color: patch.color ?? current.color });
      if (patch.capabilities) this.store.setRoleCaps(id, patch.capabilities);
      if (patch.perms) this.store.setRolePerms(id, patch.perms);
    });
    this.changed();
    return this.roleOr404(id);
  }

  deleteRole(id: string): void {
    this.roleOr404(id);
    this.guarded(() => this.store.deleteRole(id));
    this.changed();
  }

  // ---- arranque -------------------------------------------------------------

  // Importa el team.json del proof of concept. Solo con el equipo vacío (se usa una vez).
  // login = id del team.json (el admin lo cambia luego por el login de Tailscale); cada "role"
  // distinto pasa a ser un rol con requests.send y files.send.
  importLegacy(list: LegacyMember[]): number {
    if (this.store.countMembers() > 0) {
      throw new Error("El equipo ya tiene personas: --import solo se usa una vez, con la base de datos vacía");
    }
    this.db.transaction(() => {
      const roleIds = new Map<string, string>();
      for (const name of new Set(list.map((m) => m.role))) {
        const id = crypto.randomUUID();
        this.store.insertRole({ id, name, color: "#4a7bd8" });
        this.store.setRolePerms(id, ["requests.send", "files.send"]);
        roleIds.set(name, id);
      }
      list.forEach((m, i) => {
        const id = crypto.randomUUID();
        this.store.insertMember({
          id, login: m.id, name: m.name, description: m.description, disabledAt: null, createdAt: this.now() + i,
        });
        this.store.setMemberRoles(id, [roleIds.get(m.role)!]);
      });
    })();
    return list.length;
  }

  // Con --admin: crea (o completa) el rol "Admin Devi" con todos los permisos y se lo da a ese login.
  // Después exige que haya al menos un admin activo; si no, el servidor no arranca.
  ensureAdmin(adminLogin: string | undefined): void {
    if (adminLogin) {
      this.db.transaction(() => {
        let role = this.store.roleByName(ADMIN_ROLE_NAME);
        if (!role) {
          const id = crypto.randomUUID();
          this.store.insertRole({ id, name: ADMIN_ROLE_NAME, color: "#d8574a" });
          this.store.setRoleCaps(id, ["Administra Devi: personas, roles y ajustes del servidor"]);
          role = this.roleOr404(id);
        }
        this.store.setRolePerms(role.id, [...PERMS]);
        const existing = this.store.memberByLogin(adminLogin);
        if (!existing) {
          const id = crypto.randomUUID();
          this.store.insertMember({
            id, login: adminLogin, name: adminLogin.split("@")[0] || adminLogin, description: "Admin de Devi",
            disabledAt: null, createdAt: this.now(),
          });
          this.store.setMemberRoles(id, [role.id]);
        } else {
          this.store.updateMember(existing.id, { ...existing, disabledAt: null });
          this.store.setMemberRoles(existing.id, [...existing.roleIds, role.id]);
        }
      })();
    }
    if (this.store.countActiveAdmins() === 0) {
      throw new Error("No hay ningún admin de Devi. Arranca el servidor con --admin <tu login de Tailscale>");
    }
  }

  // ---- reglas ---------------------------------------------------------------

  // Aplica el cambio en una transacción y la deshace si deja a Devi sin admin.
  private guarded(fn: () => void): void {
    this.db.transaction(() => {
      fn();
      if (this.store.countActiveAdmins() === 0) throw LAST_ADMIN();
    })();
  }

  private disabledAtOf(id: string): number {
    const row = this.db.query("SELECT disabled_at FROM members WHERE id = $id").get({ id }) as { disabled_at: number };
    return row.disabled_at;
  }

  private memberOr404(id: string): Member {
    const m = this.store.member(id);
    if (!m) throw new HttpError(404, "Persona desconocida", { code: "not_found" });
    return m;
  }

  private roleOr404(id: string): Role {
    const r = this.store.role(id);
    if (!r) throw new HttpError(404, "Rol desconocido", { code: "not_found" });
    return r;
  }

  private assertLoginFree(login: string): void {
    if (this.store.memberByLogin(login)) throw new HttpError(409, `Ya hay una persona con el login ${login}`, { code: "conflict" });
  }

  private assertRoleNameFree(name: string): void {
    if (this.store.roleByName(name)) throw new HttpError(409, `Ya hay un rol llamado "${name}"`, { code: "conflict" });
  }

  private assertRolesExist(roleIds: string[]): void {
    for (const id of roleIds) {
      if (!this.store.role(id)) throw new HttpError(400, `Rol desconocido: ${id}`, { code: "invalid" });
    }
  }
}
