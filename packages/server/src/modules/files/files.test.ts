import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_SETTINGS } from "@devi/protocol";
import { createTestApp, stubTeamModule } from "../../testing/harness";
import { settingsModule } from "../settings/index";
import type { SettingsManager } from "../settings/service";
import { filesModule } from "./index";
import type { FileManager } from "./service";

const DAY = 86_400_000;
const team = stubTeamModule([
  { id: "m-a", login: "a@dev", name: "A", disabled: false, perms: [] },
  { id: "m-b", login: "b@dev", name: "B", disabled: false, perms: [] },
  { id: "m-c", login: "c@dev", name: "C", disabled: false, perms: [] },
]);

let t: ReturnType<typeof createTestApp>;
afterEach(() => t.cleanup());

async function setup() {
  t = createTestApp({ modules: [team, settingsModule, filesModule] });
  await t.app.start();
  const files = t.app.ctx.services.get("files") as FileManager;
  const valid = await files.validate([new File(["hola\n"], "nota.txt"), new File(["log"], "../log.txt")]);
  const metas = files.store({ draftId: "d1", direction: "request", authorMemberId: "m-a", peerMemberId: "m-b", files: valid });
  return { files, metas };
}

const download = (login: string, id: string) => t.call(login, "GET", `/api/v1/files/${id}`);

describe("archivos", () => {
  test("se guardan en dataDir/files/<id> con sus metadatos", async () => {
    const { files, metas } = await setup();
    expect(metas.map((m) => [m.name, m.size, m.direction])).toEqual([["nota.txt", 5, "request"], ["log.txt", 3, "request"]]);
    expect(existsSync(join(t.dataDir, "files", metas[0]!.id))).toBe(true);
    expect(files.forDraft("d1")).toEqual(metas);
    expect(files.forRequest("q1")).toEqual({ files: [], responseFiles: [] });
    files.attachToRequest("d1", "q1");
    expect(files.forRequest("q1").files).toEqual(metas);
  });

  test("descarga: autor siempre; destinatario solo tras autorizar; nadie más", async () => {
    const { files, metas } = await setup();
    const id = metas[0]!.id;
    const own = await download("a@dev", id);
    expect(own.status).toBe(200);
    expect(own.data).toBe("hola\n");
    expect(own.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(own.headers.get("Content-Disposition")).toBe("attachment; filename*=UTF-8''nota.txt");
    expect(own.headers.get("X-Devi-Sha256")).toMatch(/^[0-9a-f]{64}$/);
    expect((await download("b@dev", id)).status).toBe(403);
    files.attachToRequest("d1", "q1");
    expect((await download("b@dev", id)).status).toBe(200);
    expect((await download("c@dev", id)).status).toBe(403);
    expect((await download("a@dev", "nope")).status).toBe(404);
  });

  test("retención: 7 días tras cerrar la solicitud", async () => {
    const { metas } = await setup();
    t.app.ctx.services.get("files").attachToRequest("d1", "q1");
    t.app.ctx.bus.emit("request.closed", { requestId: "q1" });
    t.clock.advance(DEFAULT_SETTINGS.fileRetentionDays * DAY - 1);
    expect((await download("a@dev", metas[0]!.id)).status).toBe(200);
    t.clock.advance(3_600_000); // la tarea corre cada hora
    expect((await download("a@dev", metas[0]!.id)).status).toBe(410);
    expect(existsSync(join(t.dataDir, "files", metas[0]!.id))).toBe(false);
  });

  test("retención: 7 días tras descartar el borrador", async () => {
    const { metas } = await setup();
    t.app.ctx.bus.emit("draft.discarded", { draftId: "d1" });
    t.clock.advance(DEFAULT_SETTINGS.fileRetentionDays * DAY + 3_600_000);
    expect((await download("a@dev", metas[1]!.id)).status).toBe(410);
  });

  test("tope de 30 días aunque siga abierta; los días salen de settings", async () => {
    const { metas } = await setup();
    t.clock.advance(DEFAULT_SETTINGS.fileMaxAgeDays * DAY - 3_600_000);
    expect((await download("a@dev", metas[0]!.id)).status).toBe(200);
    t.clock.advance(3_600_000);
    expect((await download("a@dev", metas[0]!.id)).status).toBe(410);

    t.cleanup();
    const again = await setup();
    (t.app.ctx.services.get("settings") as SettingsManager).update({ fileMaxAgeDays: 1 });
    t.clock.advance(DAY);
    expect((await download("a@dev", again.metas[0]!.id)).status).toBe(410);
  });
});
