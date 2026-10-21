import { afterEach, describe, expect, test } from "bun:test";
import { DEFAULT_SETTINGS } from "@devi/protocol";
import { ALL_PERMS, createTestApp, stubTeamModule } from "../../testing/harness";
import { settingsModule } from "./index";

const team = stubTeamModule([
  { id: "m-admin", login: "admin@dev", name: "Admin", disabled: false, perms: ALL_PERMS },
  { id: "m-maria", login: "maria@dev", name: "María", disabled: false, perms: ["requests.send"] },
]);

let t: ReturnType<typeof createTestApp>;
afterEach(() => t.cleanup());

describe("settings", () => {
  test("valores por defecto", async () => {
    t = createTestApp({ modules: [team, settingsModule] });
    const res = await t.call("admin@dev", "GET", "/api/v1/settings");
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ ...DEFAULT_SETTINGS });
  });

  test("PATCH cambia solo lo enviado y persiste", async () => {
    t = createTestApp({ modules: [team, settingsModule] });
    const res = await t.call("admin@dev", "PATCH", "/api/v1/settings", { requestTimeoutMs: 60_000 });
    expect(res.data).toEqual({ ...DEFAULT_SETTINGS, requestTimeoutMs: 60_000 });
    expect(t.app.ctx.services.get("settings").get().requestTimeoutMs).toBe(60_000);
    expect((await t.call("admin@dev", "PATCH", "/api/v1/settings", { fileRetentionDays: 3 })).data.requestTimeoutMs).toBe(60_000);
  });

  test("valores inválidos → 400", async () => {
    t = createTestApp({ modules: [team, settingsModule] });
    expect((await t.call("admin@dev", "PATCH", "/api/v1/settings", { requestTimeoutMs: -1 })).status).toBe(400);
    expect((await t.call("admin@dev", "PATCH", "/api/v1/settings", { draftTtlMs: "mucho" })).status).toBe(400);
  });

  test("solo team.admin", async () => {
    t = createTestApp({ modules: [team, settingsModule] });
    const res = await t.call("maria@dev", "GET", "/api/v1/settings");
    expect(res.status).toBe(403);
    expect(res.data.perm).toBe("team.admin");
  });

  test("exportar devuelve una base SQLite", async () => {
    t = createTestApp({ modules: [team, settingsModule] });
    const res = await t.app.fetch(
      new Request("http://127.0.0.1/api/v1/settings/export", {
        headers: { "X-Devi-Version": "1.0.0", "X-Devi-Dev-User": "admin@dev" },
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toContain("devi-");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 15))).toBe("SQLite format 3");
  });
});
