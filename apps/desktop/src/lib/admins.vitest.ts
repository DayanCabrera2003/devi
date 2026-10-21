import type { Role } from "@devi/protocol";
import { describe, expect, test } from "vitest";
import {
  activeAdminCount,
  canDeleteRole,
  canDisableMember,
  canDropMemberRole,
  canRevokeAdminFromRole,
} from "./admins";

const ADMIN: Role = { id: "r1", name: "Admin", color: "#fff", capabilities: [], perms: ["team.admin"] };
const OTRO_ADMIN: Role = { id: "r2", name: "Jefa", color: "#fff", capabilities: [], perms: ["team.admin", "requests.send"] };
const DEV: Role = { id: "r3", name: "Dev", color: "#fff", capabilities: [], perms: ["requests.send"] };

const m = (id: string, roleIds: string[], disabled = false) => ({ id, roleIds, disabled });

describe("activeAdminCount", () => {
  test("cuenta las personas activas con team.admin por alguno de sus roles", () => {
    const team = {
      roles: [ADMIN, OTRO_ADMIN, DEV],
      members: [m("a", ["r1"]), m("b", ["r2", "r3"]), m("c", ["r3"]), m("d", ["r1"], true), m("e", ["borrado"])],
    };
    expect(activeAdminCount(team)).toBe(2);
  });

  test("sin roles ni personas es 0", () => {
    expect(activeAdminCount({ roles: [], members: [] })).toBe(0);
  });
});

describe("guardas del último admin", () => {
  const solo = { roles: [ADMIN, DEV], members: [m("a", ["r1", "r3"]), m("b", ["r3"])] };
  const dos = { roles: [ADMIN, OTRO_ADMIN, DEV], members: [m("a", ["r1"]), m("b", ["r2"])] };

  test("quitar un rol a una persona", () => {
    expect(canDropMemberRole(solo, "a", ["r1", "r3"], "r1")).toBe(false);
    expect(canDropMemberRole(solo, "a", ["r1", "r3"], "r3")).toBe(true);
    expect(canDropMemberRole(dos, "a", ["r1"], "r1")).toBe(true);
    // Con dos roles de admin, quitar uno no le quita el permiso.
    expect(canDropMemberRole({ ...solo, roles: [ADMIN, OTRO_ADMIN] }, "a", ["r1", "r2"], "r1")).toBe(true);
  });

  test("desactivar a una persona", () => {
    expect(canDisableMember(solo, "a")).toBe(false);
    expect(canDisableMember(solo, "b")).toBe(true);
    expect(canDisableMember(dos, "a")).toBe(true);
  });

  test("quitar team.admin a un rol o borrarlo", () => {
    expect(canRevokeAdminFromRole(solo, "r1")).toBe(false);
    expect(canDeleteRole(solo, "r1")).toBe(false);
    expect(canDeleteRole(solo, "r3")).toBe(true);
    expect(canRevokeAdminFromRole(dos, "r1")).toBe(true);
    expect(canDeleteRole(dos, "r2")).toBe(true);
  });

  test("si ya no hay ningún admin no bloquea nada (no se puede empeorar)", () => {
    const nadie = { roles: [DEV], members: [m("a", ["r3"])] };
    expect(canDisableMember(nadie, "a")).toBe(true);
    expect(canDeleteRole(nadie, "r3")).toBe(true);
  });
});
