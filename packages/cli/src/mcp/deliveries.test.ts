import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toChannelMessage } from "./deliveries";
import { fakeClient } from "./fake-client";

const files = (list: { id: string; name: string }[]) => JSON.stringify(list);

describe("toChannelMessage", () => {
  test("sin archivos: pasa content y meta, con kind", async () => {
    const f = fakeClient();
    const m = await toChannelMessage(
      { kind: "draft_authorized", content: "Tu solicitud salió", meta: { draft_id: "d1" } },
      { client: f.client, receivedDir: "/nunca" },
    );
    expect(m).toEqual({ content: "Tu solicitud salió", meta: { draft_id: "d1", kind: "draft_authorized" } });
  });

  test("descarga los archivos a <recibidos>/<request_id>/ y da las rutas locales", async () => {
    const dir = mkdtempSync(join(tmpdir(), "devi-recv-"));
    const f = fakeClient({ downloadFile: (id: unknown) => `contenido de ${id}` });
    const m = await toChannelMessage(
      { kind: "request", content: "María pide algo", meta: { request_id: "q1", files: files([{ id: "f1", name: "../../log.txt" }]) } },
      { client: f.client, receivedDir: dir },
    );
    const path = join(dir, "q1", "log.txt");
    expect(readFileSync(path, "utf8")).toBe("contenido de f1");
    expect(m.meta).toEqual({ request_id: "q1", kind: "request", file_paths: path });
    expect(m.content).toBe(`María pide algo\n\nArchivos adjuntos (ya en este equipo):\n- ${path}`);
  });

  test("si la app ya lo descargó, no lo vuelve a pedir", async () => {
    const dir = mkdtempSync(join(tmpdir(), "devi-recv-"));
    mkdirSync(join(dir, "q2"));
    writeFileSync(join(dir, "q2", "a.txt"), "de la app");
    const f = fakeClient();
    await toChannelMessage(
      { kind: "response", content: "r", meta: { request_id: "q2", files: files([{ id: "f1", name: "a.txt" }]) } },
      { client: f.client, receivedDir: dir },
    );
    expect(f.calls).toEqual([]);
    expect(readFileSync(join(dir, "q2", "a.txt"), "utf8")).toBe("de la app");
  });

  test("un fallo de descarga se cuenta en el texto", async () => {
    const dir = mkdtempSync(join(tmpdir(), "devi-recv-"));
    const f = fakeClient({ downloadFile: new Error("404") });
    const m = await toChannelMessage(
      { kind: "request", content: "x", meta: { request_id: "q3", files: files([{ id: "f9", name: "b.txt" }]) } },
      { client: f.client, receivedDir: dir },
    );
    expect(m.content).toContain("No se pudieron descargar: b.txt");
  });

  test("nombres repetidos en la misma solicitud: a.txt y a (2).txt", async () => {
    const dir = mkdtempSync(join(tmpdir(), "devi-recv-"));
    const f = fakeClient({ downloadFile: (id: unknown) => `c-${id}` });
    const m = await toChannelMessage(
      { kind: "request", content: "x", meta: { request_id: "q4", files: files([{ id: "f1", name: "a.txt" }, { id: "f2", name: "a.txt" }]) } },
      { client: f.client, receivedDir: dir },
    );
    expect(readFileSync(join(dir, "q4", "a.txt"), "utf8")).toBe("c-f1");
    expect(readFileSync(join(dir, "q4", "a (2).txt"), "utf8")).toBe("c-f2");
    expect(m.meta.file_paths.split("\n")).toHaveLength(2);
  });

  test("una descarga fallida no deja archivo final ni temporal", async () => {
    const dir = mkdtempSync(join(tmpdir(), "devi-recv-"));
    const f = fakeClient({ downloadFile: new Error("corte") });
    await toChannelMessage(
      { kind: "request", content: "x", meta: { request_id: "q5", files: files([{ id: "f1", name: "a.txt" }]) } },
      { client: f.client, receivedDir: dir },
    );
    expect(readdirSync(join(dir, "q5"))).toEqual([]);
  });
});
