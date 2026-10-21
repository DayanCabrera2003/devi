import type { Database } from "bun:sqlite";
import { PERMS, type Member, type Perm, type Role } from "@devi/protocol";
import type { Migration } from "../../core/db";

export const teamMigrations: Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE members (
        id TEXT PRIMARY KEY,
        login TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        disabled_at INTEGER
      );
      CREATE TABLE roles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        color TEXT NOT NULL
      );
      CREATE TABLE role_caps (
        role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        text TEXT NOT NULL,
        PRIMARY KEY (role_id, position)
      );
      CREATE TABLE role_perms (
        role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        perm TEXT NOT NULL,
        PRIMARY KEY (role_id, perm)
      );
      CREATE TABLE member_roles (
        member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        PRIMARY KEY (member_id, role_id)
      );
    `,
  },
];

type MemberRow = { id: string; login: string; name: string; description: string; disabled_at: number | null };
type RoleRow = { id: string; name: string; color: string };

export type MemberFields = { login: string; name: string; description: string; disabledAt: number | null };
export type RoleFields = { name: string; color: string };

// Solo SQL. Las reglas (login único, último admin…) están en service.ts.
export class TeamStore {
  constructor(private db: Database) {}

  // ---- personas -------------------------------------------------------------

  members(): Member[] {
    const rows = this.db
      .query("SELECT id, login, name, description, disabled_at FROM members ORDER BY created_at, name")
      .all() as MemberRow[];
    return rows.map((r) => this.toMember(r));
  }

  member(id: string): Member | null {
    const row = this.db
      .query("SELECT id, login, name, description, disabled_at FROM members WHERE id = $id")
      .get({ id }) as MemberRow | null;
    return row ? this.toMember(row) : null;
  }

  memberByLogin(login: string): Member | null {
    const row = this.db
      .query("SELECT id, login, name, description, disabled_at FROM members WHERE login = $login")
      .get({ login }) as MemberRow | null;
    return row ? this.toMember(row) : null;
  }

  countMembers(): number {
    return (this.db.query("SELECT COUNT(*) AS n FROM members").get() as { n: number }).n;
  }

  insertMember(m: MemberFields & { id: string; createdAt: number }): void {
    this.db
      .query(
        `INSERT INTO members (id, login, name, description, created_at, disabled_at)
         VALUES ($id, $login, $name, $description, $createdAt, $disabledAt)`,
      )
      .run(m);
  }

  updateMember(id: string, f: MemberFields): void {
    this.db
      .query(
        `UPDATE members SET login = $login, name = $name, description = $description, disabled_at = $disabledAt
         WHERE id = $id`,
      )
      .run({ id, ...f });
  }

  setMemberRoles(memberId: string, roleIds: string[]): void {
    this.db.query("DELETE FROM member_roles WHERE member_id = $memberId").run({ memberId });
    const ins = this.db.query("INSERT INTO member_roles (member_id, role_id) VALUES ($memberId, $roleId)");
    for (const roleId of new Set(roleIds)) ins.run({ memberId, roleId });
  }

  deleteMember(id: string): void {
    this.db.query("DELETE FROM members WHERE id = $id").run({ id });
  }

  // ---- roles ----------------------------------------------------------------

  roles(): Role[] {
    const rows = this.db.query("SELECT id, name, color FROM roles ORDER BY name").all() as RoleRow[];
    return rows.map((r) => this.toRole(r));
  }

  role(id: string): Role | null {
    const row = this.db.query("SELECT id, name, color FROM roles WHERE id = $id").get({ id }) as RoleRow | null;
    return row ? this.toRole(row) : null;
  }

  roleByName(name: string): Role | null {
    const row = this.db.query("SELECT id, name, color FROM roles WHERE name = $name").get({ name }) as RoleRow | null;
    return row ? this.toRole(row) : null;
  }

  insertRole(r: RoleFields & { id: string }): void {
    this.db.query("INSERT INTO roles (id, name, color) VALUES ($id, $name, $color)").run(r);
  }

  updateRole(id: string, f: RoleFields): void {
    this.db.query("UPDATE roles SET name = $name, color = $color WHERE id = $id").run({ id, ...f });
  }

  setRoleCaps(roleId: string, caps: string[]): void {
    this.db.query("DELETE FROM role_caps WHERE role_id = $roleId").run({ roleId });
    const ins = this.db.query("INSERT INTO role_caps (role_id, position, text) VALUES ($roleId, $position, $text)");
    caps.forEach((text, position) => ins.run({ roleId, position, text }));
  }

  setRolePerms(roleId: string, perms: Perm[]): void {
    this.db.query("DELETE FROM role_perms WHERE role_id = $roleId").run({ roleId });
    const ins = this.db.query("INSERT INTO role_perms (role_id, perm) VALUES ($roleId, $perm)");
    for (const perm of new Set(perms)) ins.run({ roleId, perm });
  }

  deleteRole(id: string): void {
    this.db.query("DELETE FROM roles WHERE id = $id").run({ id });
  }

  // ---- permisos -------------------------------------------------------------

  // Unión de los permisos de los roles de la persona, en el orden de PERMS.
  permsOf(memberId: string): Perm[] {
    const rows = this.db
      .query(
        `SELECT DISTINCT rp.perm AS perm FROM member_roles mr
         JOIN role_perms rp ON rp.role_id = mr.role_id WHERE mr.member_id = $memberId`,
      )
      .all({ memberId }) as { perm: string }[];
    const set = new Set(rows.map((r) => r.perm));
    return PERMS.filter((p) => set.has(p));
  }

  // Personas activas con team.admin (para no quedarse nunca sin admin).
  countActiveAdmins(): number {
    const row = this.db
      .query(
        `SELECT COUNT(DISTINCT m.id) AS n FROM members m
         JOIN member_roles mr ON mr.member_id = m.id
         JOIN role_perms rp ON rp.role_id = mr.role_id
         WHERE m.disabled_at IS NULL AND rp.perm = 'team.admin'`,
      )
      .get() as { n: number };
    return row.n;
  }

  private toMember(r: MemberRow): Member {
    const roleIds = (
      this.db.query("SELECT role_id FROM member_roles WHERE member_id = $id ORDER BY role_id").all({ id: r.id }) as {
        role_id: string;
      }[]
    ).map((x) => x.role_id);
    return { id: r.id, login: r.login, name: r.name, description: r.description, roleIds, disabled: r.disabled_at !== null };
  }

  private toRole(r: RoleRow): Role {
    const capabilities = (
      this.db.query("SELECT text FROM role_caps WHERE role_id = $id ORDER BY position").all({ id: r.id }) as { text: string }[]
    ).map((x) => x.text);
    return { id: r.id, name: r.name, color: r.color, capabilities, perms: this.permsOfRole(r.id) };
  }

  private permsOfRole(roleId: string): Perm[] {
    const rows = this.db.query("SELECT perm FROM role_perms WHERE role_id = $roleId").all({ roleId }) as { perm: string }[];
    const set = new Set(rows.map((r) => r.perm));
    return PERMS.filter((p) => set.has(p));
  }
}
