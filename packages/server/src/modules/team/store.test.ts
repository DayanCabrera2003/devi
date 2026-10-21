import { describe, expect, test } from "bun:test";
import { migrate, openDb } from "../../core/db";
import { TeamStore, teamMigrations } from "./store";

function setup() {
  const db = openDb();
  migrate(db, "team", teamMigrations);
  const store = new TeamStore(db);
  store.insertRole({ id: "r-admin", name: "Admin Devi", color: "#d8574a" });
  store.setRolePerms("r-admin", ["team.admin", "requests.send"]);
  store.insertRole({ id: "r-back", name: "Backend", color: "#4a7bd8" });
  store.setRolePerms("r-back", ["requests.send", "files.send"]);
  store.setRoleCaps("r-back", ["Aprobar PRs backend", "Ver logs"]);
  store.insertMember({ id: "m1", login: "dayan@x", name: "Dayan", description: "", disabledAt: null, createdAt: 1 });
  store.insertMember({ id: "m2", login: "maria@x", name: "María", description: "API", disabledAt: null, createdAt: 2 });
  store.setMemberRoles("m1", ["r-admin", "r-back"]);
  store.setMemberRoles("m2", ["r-back"]);
  return { db, store };
}

describe("TeamStore", () => {
  test("persona con roles", () => {
    const { store } = setup();
    expect(store.memberByLogin("maria@x")).toEqual({
      id: "m2", login: "maria@x", name: "María", description: "API", roleIds: ["r-back"], disabled: false,
    });
    expect(store.member("nadie")).toBeNull();
    expect(store.members().map((m) => m.id)).toEqual(["m1", "m2"]);
  });

  test("rol con capacidades en orden y permisos", () => {
    const { store } = setup();
    expect(store.role("r-back")).toEqual({
      id: "r-back", name: "Backend", color: "#4a7bd8",
      capabilities: ["Aprobar PRs backend", "Ver logs"], perms: ["requests.send", "files.send"],
    });
    expect(store.roleByName("Admin Devi")?.id).toBe("r-admin");
  });

  test("permisos = unión de los roles, en el orden de PERMS", () => {
    const { store } = setup();
    expect(store.permsOf("m1")).toEqual(["requests.send", "files.send", "team.admin"]);
    expect(store.permsOf("m2")).toEqual(["requests.send", "files.send"]);
  });

  test("contar admins activos", () => {
    const { store } = setup();
    expect(store.countActiveAdmins()).toBe(1);
    store.updateMember("m1", { login: "dayan@x", name: "Dayan", description: "", disabledAt: 5 });
    expect(store.countActiveAdmins()).toBe(0);
  });

  test("borrar un rol lo quita de las personas (cascada)", () => {
    const { store } = setup();
    store.deleteRole("r-back");
    expect(store.member("m2")?.roleIds).toEqual([]);
  });

  test("login único", () => {
    const { store } = setup();
    expect(() =>
      store.insertMember({ id: "m3", login: "maria@x", name: "Otra", description: "", disabledAt: null, createdAt: 3 }),
    ).toThrow();
  });
});
