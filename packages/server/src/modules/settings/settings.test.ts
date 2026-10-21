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

  test("límites: timeout 1 min–7 días, borrador 1 min–24 h, retención 1–30 días, tope 1–30 días", async () => {
    t = createTestApp({ modules: [team, settingsModule] });
    const patch = (b: object) => t.call("admin@dev", "PATCH", "/api/v1/settings", b);
    const MIN = 60_000;
    const DAY = 86_400_000;
    for (const bad of [
      { requestTimeoutMs: MIN - 1 }, { requestTimeoutMs: 7 * DAY + 1 },
      { draftTtlMs: MIN - 1 }, { draftTtlMs: 24 * 3_600_000 + 1 },
      { fileRetentionDays: 0 }, { fileRetentionDays: 31 }, { fileMaxAgeDays: 0 }, { fileMaxAgeDays: 31 },
    ]) {
      expect((await patch(bad)).status).toBe(400);
    }
    for (const good of [{ requestTimeoutMs: MIN }, { requestTimeoutMs: 7 * DAY }, { draftTtlMs: MIN }, { draftTtlMs: 24 * 3_600_000 }]) {
      expect((await patch(good)).status).toBe(200);
    }
    expect((await patch({ fileRetentionDays: 30, fileMaxAgeDays: 30 })).status).toBe(200);
  });

  test("tope de archivos ≥ retención (en el servicio, también con parches parciales)", async () => {
    t = createTestApp({ modules: [team, settingsModule] });
    const patch = (b: object) => t.call("admin@dev", "PATCH", "/api/v1/settings", b);
    const bad = await patch({ fileMaxAgeDays: 3 }); // retención por defecto: 7
    expect(bad.status).toBe(400);
    expect(bad.data.error).toContain("fileMaxAgeDays");
    expect((await patch({ fileRetentionDays: 20 })).status).toBe(200);
    expect((await patch({ fileMaxAgeDays: 10 })).status).toBe(400);
    expect((await t.call("admin@dev", "GET", "/api/v1/settings")).data).toMatchObject({ fileRetentionDays: 20, fileMaxAgeDays: 30 });
    expect((await patch({ fileRetentionDays: 2, fileMaxAgeDays: 2 })).status).toBe(200);
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
        headers: { "X-Devi-Version": "1.0.0", "X-Devi-Dev-User": "admin@dev", Origin: "tauri://localhost" },
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="devi.db"');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 15))).toBe("SQLite format 3");
  });
});
