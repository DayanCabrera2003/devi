import { afterEach, describe, expect, test } from "bun:test";
import { openDb } from "../../core/db";
import { createTestApp } from "../../testing/harness";
import { teamModule } from "../team/index";
import { settingsModule } from "./index";

let t: ReturnType<typeof createTestApp>;
afterEach(() => t.cleanup());

const ADMIN = "dayan@asai.digital";

async function started(opts: { allowedDomains?: string[]; db?: ReturnType<typeof openDb>; adminLogin?: string } = {}) {
  t = createTestApp({ modules: [teamModule, settingsModule], adminLogin: opts.adminLogin ?? ADMIN, allowedDomains: opts.allowedDomains, db: opts.db });
  await t.app.start();
  return t;
}

describe("dominios permitidos", () => {
  test("sin dominios (por defecto) cualquier login del equipo entra", async () => {
    await started();
    expect((await t.call(ADMIN, "GET", "/api/v1/settings")).data.allowedDomains).toEqual([]);
    await t.call(ADMIN, "POST", "/api/v1/team/members", { login: "ana@gmail.com", name: "Ana" });
    expect((await t.call("ana@gmail.com", "GET", "/api/v1/me")).status).toBe(200);
  });

  test("--allowed-domain siembra el ajuste y es idempotente al reiniciar", async () => {
    const db = openDb();
    await started({ allowedDomains: ["asai.digital"], db });
    expect((await t.call(ADMIN, "GET", "/api/v1/settings")).data.allowedDomains).toEqual(["asai.digital"]);
    await t.call(ADMIN, "PATCH", "/api/v1/settings", { allowedDomains: ["asai.digital", "otra.com"] });
    t.cleanup();
    await started({ allowedDomains: ["asai.digital"], db });
    expect((await t.call(ADMIN, "GET", "/api/v1/settings")).data.allowedDomains).toEqual(["asai.digital", "otra.com"]);
  });

  test("login de otro dominio → 403 domain ANTES de buscar a la persona", async () => {
    await started({ allowedDomains: ["asai.digital"] });
    const res = await t.call("intruso@gmail.com", "GET", "/api/v1/me");
    expect(res.status).toBe(403);
    expect(res.data).toMatchObject({ code: "domain", login: "intruso@gmail.com" });
    // También a un miembro que ya existía de antes con otro dominio.
    const res2 = await t.call("DAYAN@ASAI.DIGITAL", "GET", "/api/v1/me");
    expect(res2.data.code).not.toBe("domain");
  });

  test("crear o cambiar una persona con un login fuera de los dominios → 400", async () => {
    await started({ allowedDomains: ["asai.digital"] });
    const bad = await t.call(ADMIN, "POST", "/api/v1/team/members", { login: "ana@gmail.com", name: "Ana" });
    expect(bad.status).toBe(400);
    expect(bad.data.code).toBe("domain");
    const ok = await t.call(ADMIN, "POST", "/api/v1/team/members", { login: "ana@Asai.Digital", name: "Ana" });
    expect(ok.status).toBe(200);
    const upd = await t.call(ADMIN, "PATCH", `/api/v1/team/members/${ok.data.id}`, { login: "ana@gmail.com" });
    expect(upd.status).toBe(400);
    expect((await t.call(ADMIN, "PATCH", `/api/v1/team/members/${ok.data.id}`, { name: "Ana B" })).status).toBe(200);
  });

  test("el admin no puede dejar fuera su propio dominio", async () => {
    await started();
    const res = await t.call(ADMIN, "PATCH", "/api/v1/settings", { allowedDomains: ["otra.com"] });
    expect(res.status).toBe(400);
    expect((await t.call(ADMIN, "PATCH", "/api/v1/settings", { allowedDomains: ["asai.digital"] })).status).toBe(200);
    expect((await t.call(ADMIN, "PATCH", "/api/v1/settings", { allowedDomains: [] })).status).toBe(200);
  });

  test("--admin fuera de los dominios: el servidor no arranca", async () => {
    t = createTestApp({ modules: [teamModule, settingsModule], adminLogin: "yo@gmail.com", allowedDomains: ["asai.digital"] });
    await expect(t.app.start()).rejects.toThrow("asai.digital");
  });
});
