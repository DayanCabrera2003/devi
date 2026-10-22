import { afterEach, describe, expect, test } from "bun:test";
import { openDb } from "../../core/db";
import { createTestApp, stubTeamModule } from "../../testing/harness";
import { prefsModule } from "./index";

const team = stubTeamModule([
  { id: "m-ana", login: "ana@dev", name: "Ana", disabled: false, perms: ["requests.send"] },
  { id: "m-leo", login: "leo@dev", name: "Leo", disabled: false, perms: [] },
]);

let t: ReturnType<typeof createTestApp>;
afterEach(() => t.cleanup());

describe("preferencias del miembro", () => {
  test("por defecto, avisos en las sesiones activados", async () => {
    t = createTestApp({ modules: [team, prefsModule] });
    const res = await t.call("ana@dev", "GET", "/api/v1/me/prefs");
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ sessionNotices: true });
    expect(t.app.ctx.services.get("prefs").of("m-ana")).toEqual({ sessionNotices: true });
  });

  test("cada persona cambia solo las suyas y persisten", async () => {
    const db = openDb();
    t = createTestApp({ modules: [team, prefsModule], db });
    const off = await t.call("ana@dev", "PATCH", "/api/v1/me/prefs", { sessionNotices: false });
    expect(off.status).toBe(200);
    expect(off.data).toEqual({ sessionNotices: false });
    expect((await t.call("leo@dev", "GET", "/api/v1/me/prefs")).data).toEqual({ sessionNotices: true });
    expect((await t.call("ana@dev", "PATCH", "/api/v1/me/prefs", {})).data).toEqual({ sessionNotices: false });
    t.cleanup();
    t = createTestApp({ modules: [team, prefsModule], db });
    expect(t.app.ctx.services.get("prefs").of("m-ana").sessionNotices).toBe(false);
  });

  test("cambiarlas es una acción humana (solo desde la app) y valida el cuerpo", async () => {
    t = createTestApp({ modules: [team, prefsModule] });
    const agent = await t.call("ana@dev", "PATCH", "/api/v1/me/prefs", { sessionNotices: false }, { origin: null });
    expect(agent.status).toBe(403);
    expect((await t.call("ana@dev", "GET", "/api/v1/me/prefs", undefined, { origin: null })).data.sessionNotices).toBe(true);
    expect((await t.call("ana@dev", "PATCH", "/api/v1/me/prefs", { sessionNotices: "no" })).status).toBe(400);
  });
});
