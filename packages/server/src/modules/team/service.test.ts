import { describe, expect, test } from "bun:test";
import { migrate, openDb } from "../../core/db";
import { HttpError } from "../../core/http";
import { ADMIN_ROLE_NAME, TeamManager } from "./service";
import { TeamStore, teamMigrations } from "./store";

function setup() {
  const db = openDb();
  migrate(db, "team", teamMigrations);
  let changes = 0;
  const team = new TeamManager(new TeamStore(db), db, () => 1000, () => changes++);
  return { db, team, changes: () => changes };
}

const statusOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as HttpError).status;
  }
  return 0;
};

function withAdmin() {
  const s = setup();
  s.team.ensureAdmin("dayan@x");
  const back = s.team.createRole({ name: "Backend", color: "#4a7bd8", capabilities: ["Aprobar PRs"], perms: ["requests.send"] });
  const maria = s.team.createMember({ login: "maria@x", name: "María", description: "API", roleIds: [back.id] });
  const admin = s.team.member(s.team.resolveAccess("dayan@x")!.memberId)!;
  return { ...s, back, maria, admin };
}

describe("bootstrap del admin", () => {
  test("sin admin y sin --admin no arranca", () => {
    expect(() => setup().team.ensureAdmin(undefined)).toThrow("--admin");
  });

  test("--admin crea el rol Admin Devi con todos los permisos y la persona", () => {
    const { team } = setup();
    team.ensureAdmin("dayan@x");
    const access = team.resolveAccess("dayan@x")!;
    expect([...access.perms].sort()).toEqual(["files.send", "requests.send", "team.admin"]);
    const me = team.me("dayan@x", access.memberId);
    expect(me.member.name).toBe("dayan");
    expect(me.roles.map((r) => r.name)).toEqual([ADMIN_ROLE_NAME]);
  });

  test("es idempotente y, si ya hay admin, --admin no hace falta", () => {
    const { team } = setup();
    team.ensureAdmin("dayan@x");
    team.ensureAdmin("dayan@x");
    team.ensureAdmin(undefined);
    expect(team.view(() => false).members).toHaveLength(1);
  });

  test("--admin nunca falla al reiniciar y dice qué pasó (la app lo pasa en cada arranque)", () => {
    const { team } = setup();
    expect(team.ensureAdmin("dayan@x")).toBe("created");
    expect(team.ensureAdmin("dayan@x")).toBe("already_admin");
    expect(team.ensureAdmin(undefined)).toBe("admins_exist");
    expect(team.ensureAdmin("maria@x")).toBe("created"); // otra persona: se añade, sin romper nada
    expect(team.ensureAdmin("maria@x")).toBe("already_admin");
    expect(team.view(() => false).members).toHaveLength(2);
  });

  test("--admin sobre una persona existente le añade el rol sin quitarle los suyos", () => {
    const { team, back, maria } = withAdmin();
    team.ensureAdmin("maria@x");
    const m = team.me("maria@x", maria.id);
    expect(m.roles.map((r) => r.name).sort()).toEqual([ADMIN_ROLE_NAME, "Backend"]);
    expect(m.member.roleIds).toContain(back.id);
  });
});

describe("acceso", () => {
  test("login desconocido o persona desactivada → null", () => {
    const { team, maria } = withAdmin();
    expect(team.resolveAccess("nadie@x")).toBeNull();
    expect([...team.resolveAccess("maria@x")!.perms]).toEqual(["requests.send"]);
    team.updateMember(maria.id, { disabled: true });
    expect(team.resolveAccess("maria@x")).toBeNull();
  });

  test("los permisos son la unión de los roles", () => {
    const { team, back, maria } = withAdmin();
    const files = team.createRole({ name: "Archivos", color: "#000", capabilities: [], perms: ["files.send"] });
    team.updateMember(maria.id, { roleIds: [back.id, files.id] });
    expect([...team.resolveAccess("maria@x")!.perms]).toEqual(["requests.send", "files.send"]);
  });
});

describe("personas y roles", () => {
  test("PATCH solo cambia lo enviado", () => {
    const { team, maria, back } = withAdmin();
    const m = team.updateMember(maria.id, { name: "María José" });
    expect(m).toEqual({ ...maria, name: "María José" });
    expect(m.roleIds).toEqual([back.id]);
    const r = team.updateRole(back.id, { color: "#111111" });
    expect(r.capabilities).toEqual(["Aprobar PRs"]);
    expect(r.perms).toEqual(["requests.send"]);
  });

  test("login y nombre de rol únicos (409); rol desconocido (400); persona desconocida (404)", () => {
    const { team, maria } = withAdmin();
    expect(statusOf(() => team.createMember({ login: "maria@x", name: "X", description: "", roleIds: [] }))).toBe(409);
    expect(statusOf(() => team.createRole({ name: "Backend", color: "#000", capabilities: [], perms: [] }))).toBe(409);
    expect(statusOf(() => team.updateMember(maria.id, { roleIds: ["nope"] }))).toBe(400);
    expect(statusOf(() => team.updateMember("nope", { name: "x" }))).toBe(404);
  });

  test("reactivar a alguien", () => {
    const { team, maria } = withAdmin();
    team.updateMember(maria.id, { disabled: true });
    team.updateMember(maria.id, { name: "María" });
    expect(team.member(maria.id)?.disabled).toBe(true);
    team.updateMember(maria.id, { disabled: false });
    expect(team.resolveAccess("maria@x")).not.toBeNull();
  });

  test("avisa de cada cambio", () => {
    const { changes } = withAdmin();
    expect(changes()).toBe(2);
  });
});

describe("nunca sin admin (409 y sin cambios)", () => {
  test("desactivar, borrar o quitar el rol al último admin", () => {
    const { team, admin } = withAdmin();
    expect(statusOf(() => team.updateMember(admin.id, { disabled: true }))).toBe(409);
    expect(statusOf(() => team.updateMember(admin.id, { roleIds: [] }))).toBe(409);
    expect(statusOf(() => team.deleteMember(admin.id))).toBe(409);
    expect(team.resolveAccess("dayan@x")?.perms.has("team.admin")).toBe(true);
  });

  test("quitar team.admin al rol o borrarlo", () => {
    const { team } = withAdmin();
    const role = team.view(() => false).roles.find((r) => r.name === ADMIN_ROLE_NAME)!;
    expect(statusOf(() => team.updateRole(role.id, { perms: ["requests.send"] }))).toBe(409);
    expect(statusOf(() => team.deleteRole(role.id))).toBe(409);
    expect(team.view(() => false).roles.find((r) => r.id === role.id)?.perms).toContain("team.admin");
  });

  test("con dos admins sí se puede quitar uno", () => {
    const { team, admin, maria } = withAdmin();
    const role = team.view(() => false).roles.find((r) => r.name === ADMIN_ROLE_NAME)!;
    team.updateMember(maria.id, { roleIds: [role.id] });
    team.updateMember(admin.id, { disabled: true });
    expect(team.resolveAccess("dayan@x")).toBeNull();
  });
});

describe("importar team.json", () => {
  const legacy = [
    { id: "dayan", name: "Dayan", role: "Tech Lead", description: "Owner en GCP" },
    { id: "maria", name: "María", role: "Backend developer", description: "Mantiene la API" },
    { id: "leo", name: "Leo", role: "Backend developer", description: "DevOps" },
  ];

  test("login = id, un rol por cada role distinto, con requests.send y files.send", () => {
    const { team } = setup();
    expect(team.importLegacy(legacy)).toBe(3);
    const view = team.view(() => false);
    expect(view.members.map((m) => m.login)).toEqual(["dayan", "maria", "leo"]);
    expect(view.roles.map((r) => r.name).sort()).toEqual(["Backend developer", "Tech Lead"]);
    expect(view.roles.every((r) => r.perms.join() === "requests.send,files.send")).toBe(true);
    expect(view.members[1]?.description).toBe("Mantiene la API");
  });

  test("solo con el equipo vacío", () => {
    const { team } = setup();
    team.importLegacy(legacy);
    expect(() => team.importLegacy(legacy)).toThrow("solo se usa una vez");
  });
});
