import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestApp } from "../../testing/harness";
import { teamModule } from "./index";

let t: ReturnType<typeof createTestApp>;
afterEach(() => t.cleanup());

async function started(adminLogin = "dayan@dev") {
  t = createTestApp({ modules: [teamModule], adminLogin });
  await t.app.start();
  return t;
}

describe("team por HTTP", () => {
  test("arrancar sin admin falla", async () => {
    t = createTestApp({ modules: [teamModule] });
    await expect(t.app.start()).rejects.toThrow("--admin");
  });

  test("me del admin", async () => {
    await started();
    const res = await t.call("dayan@dev", "GET", "/api/v1/me");
    expect(res.status).toBe(200);
    expect(res.data.login).toBe("dayan@dev");
    expect(res.data.perms).toEqual(["requests.send", "files.send", "team.admin"]);
  });

  test("login desconocido → 403 unknown_login", async () => {
    await started();
    const res = await t.call("nadie@dev", "GET", "/api/v1/me");
    expect(res.status).toBe(403);
    expect(res.data).toMatchObject({ code: "unknown_login", login: "nadie@dev" });
  });

  test("CRUD de admin y 403 para quien no es admin", async () => {
    await started();
    const role = await t.call("dayan@dev", "POST", "/api/v1/team/roles", { name: "Backend", perms: ["requests.send"] });
    expect(role.status).toBe(200);
    expect(role.data).toMatchObject({ name: "Backend", color: "#4a7bd8", capabilities: [], perms: ["requests.send"] });
    const maria = await t.call("dayan@dev", "POST", "/api/v1/team/members", {
      login: "maria@dev", name: "María", roleIds: [role.data.id],
    });
    expect(maria.data).toMatchObject({ login: "maria@dev", description: "", roleIds: [role.data.id], disabled: false });

    const denied = await t.call("maria@dev", "POST", "/api/v1/team/roles", { name: "X" });
    expect(denied.status).toBe(403);
    expect(denied.data).toMatchObject({ code: "missing_perm", perm: "team.admin" });

    const patched = await t.call("dayan@dev", "PATCH", `/api/v1/team/members/${maria.data.id}`, { name: "María José" });
    expect(patched.data.roleIds).toEqual([role.data.id]);
    expect((await t.call("dayan@dev", "DELETE", `/api/v1/team/roles/${role.data.id}`)).data).toEqual({ ok: true });
    expect((await t.call("dayan@dev", "DELETE", `/api/v1/team/members/${maria.data.id}`)).data).toEqual({ ok: true });
    expect((await t.call("maria@dev", "GET", "/api/v1/me")).status).toBe(403);
  });

  test("quitarse el último admin → 409 last_admin", async () => {
    await started();
    const me = await t.call("dayan@dev", "GET", "/api/v1/me");
    const res = await t.call("dayan@dev", "PATCH", `/api/v1/team/members/${me.data.member.id}`, { disabled: true });
    expect(res.status).toBe(409);
    expect(res.data.code).toBe("last_admin");
  });

  test("team: connected según presencia y team.updated a las apps", async () => {
    await started();
    const me = (await t.call("dayan@dev", "GET", "/api/v1/me")).data.member;
    expect((await t.call("dayan@dev", "GET", "/api/v1/team")).data.members[0].connected).toBe(false);
    const ac = new AbortController();
    t.app.ctx.presence.open(`user:${me.id}`, ac.signal);
    expect((await t.call("dayan@dev", "GET", "/api/v1/team")).data.members[0].connected).toBe(true);
    expect(t.userEvents(me.id)).toContainEqual({ type: "team.updated" });
    await t.call("dayan@dev", "POST", "/api/v1/team/roles", { name: "Otro" });
    expect(t.userEvents(me.id).filter((e) => e.type === "team.updated").length).toBe(2);
    ac.abort();
    expect((await t.call("dayan@dev", "GET", "/api/v1/team")).data.members[0].connected).toBe(false);
  });

  test("--import team.json, y --admin además", async () => {
    const dir = mkdtempSync(join(tmpdir(), "devi-import-"));
    const path = join(dir, "team.json");
    writeFileSync(path, JSON.stringify([{ id: "maria", name: "María", role: "Backend", description: "API" }]));
    t = createTestApp({ modules: [teamModule], importTeam: path, adminLogin: "dayan@dev" });
    await t.app.start();
    const team = (await t.call("dayan@dev", "GET", "/api/v1/team")).data;
    expect(team.members.map((m: { login: string }) => m.login).sort()).toEqual(["dayan@dev", "maria"]);
    rmSync(dir, { recursive: true, force: true });
  });
});
