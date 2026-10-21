import { describe, expect, test, vi } from "vitest";
import { ME, TEAM } from "../test-fixtures";
import { TeamStore } from "./team.svelte";

describe("TeamStore", () => {
  test("refresh carga me y team", async () => {
    const t = new TeamStore();
    expect(t.isAdmin).toBe(false);
    await t.refresh({ me: vi.fn(async () => ME), team: vi.fn(async () => TEAM) });
    expect(t.myId).toBe("m1");
    expect(t.isAdmin).toBe(true);
    expect(t.connectedCount).toBe(1);
    expect(t.nameOf("m2")).toBe("María");
    expect(t.nameOf("desconocido")).toBe("desconocido");
    expect(t.role("r1")?.name).toBe("Admin");
  });

  test("sin team.admin no es admin", async () => {
    const t = new TeamStore();
    await t.refresh({ me: async () => ({ ...ME, perms: ["requests.send"] }), team: async () => TEAM });
    expect(t.isAdmin).toBe(false);
  });
});
