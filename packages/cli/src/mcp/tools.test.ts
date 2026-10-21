import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeviApiError } from "@devi/client";
import { fakeClient, unreachable } from "./fake-client";
import { TOOLS, callTool } from "./tools";

const cwd = mkdtempSync(join(tmpdir(), "devi-tools-"));
writeFileSync(join(cwd, "log.txt"), "error en línea 3");

const member = (id: string, name: string, roleIds: string[], connected: boolean, disabled = false) => ({
  id, login: `${id}@dev`, name, description: `desc ${name}`, roleIds, disabled, connected,
});
const ME = { login: "dayan@dev", member: member("m1", "Dayan", [], true), roles: [], perms: ["requests.send"] };
const TEAM = {
  members: [
    member("m1", "Dayan", ["r1"], true),
    member("m2", "María", ["r1", "r2"], true),
    member("m3", "Leo", ["r2"], false),
    member("m4", "Ana", ["r2"], true, true),
  ],
  roles: [
    { id: "r1", name: "Backend", color: "#000", capabilities: ["Aprobar PRs backend"], perms: [] },
    { id: "r2", name: "Cloud", color: "#000", capabilities: ["Permisos de GCP", "Aprobar PRs backend"], perms: [] },
  ],
};
const DRAFT = { id: "d1" };
const deps = (client: ReturnType<typeof fakeClient>["client"] | null, sessionId: string | null = "s1") => ({
  client, configError: client ? null : "Devi no está configurado: falta la URL del servidor.", cwd, sessionId: () => sessionId,
});

test("las tres herramientas, con files opcional", () => {
  expect(TOOLS.map((t) => t.name)).toEqual(["list_teammates", "send_request", "respond_to_request"]);
  expect(TOOLS[1]!.inputSchema.required).toEqual(["to", "message"]);
  expect(TOOLS[2]!.inputSchema.required).toEqual(["request_id", "message"]);
});

describe("list_teammates", () => {
  test("solo conectados y activos, sin mí, con roles y capacidades", async () => {
    const f = fakeClient({ me: ME, team: TEAM });
    const r = await callTool("list_teammates", {}, deps(f.client));
    expect(r.isError).toBe(false);
    expect(JSON.parse(r.content[0]!.text)).toEqual([
      { id: "m2", name: "María", roles: ["Backend", "Cloud"], capabilities: ["Aprobar PRs backend", "Permisos de GCP"], description: "desc María" },
    ]);
  });

  test("nadie conectado", async () => {
    const f = fakeClient({ me: ME, team: { members: [TEAM.members[0]], roles: [] } });
    expect((await callTool("list_teammates", {}, deps(f.client))).content[0]!.text).toBe("No hay compañeros conectados a Devi ahora mismo.");
  });
});

describe("send_request", () => {
  test("crea un borrador con archivos y avisa de que falta autorizar", async () => {
    const f = fakeClient({ createDraft: DRAFT });
    const r = await callTool("send_request", { to: "m2", message: "¿me apruebas el PR?", files: ["log.txt"] }, deps(f.client));
    expect(r.isError).toBe(false);
    expect(f.drafts).toEqual([
      { meta: { kind: "request", sessionId: "s1", to: "m2", message: "¿me apruebas el PR?" }, files: [{ name: "log.txt", content: "error en línea 3" }] },
    ]);
    expect(r.content[0]!.text).toContain("esperando autorización en la app de Devi");
    expect(r.content[0]!.text).toContain("log.txt");
  });

  test("archivo inválido → error y no crea borrador", async () => {
    const f = fakeClient({ createDraft: DRAFT });
    const r = await callTool("send_request", { to: "m2", message: "x", files: ["no.txt"] }, deps(f.client));
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toContain("no.txt: no existe");
    expect(f.drafts).toEqual([]);
  });

  test("argumentos que faltan", async () => {
    const f = fakeClient();
    expect((await callTool("send_request", { message: "x" }, deps(f.client))).content[0]!.text).toContain("Falta 'to'");
    expect((await callTool("send_request", { to: "m2", message: " " }, deps(f.client))).content[0]!.text).toContain("Falta 'message'");
    expect((await callTool("send_request", { to: "m2", message: "x", files: "a" }, deps(f.client))).isError).toBe(true);
  });

  test("sin sesión registrada", async () => {
    const r = await callTool("send_request", { to: "m2", message: "x" }, deps(fakeClient().client, null));
    expect(r.content[0]!.text).toContain("aún no está registrada");
  });

  test("servidor caído o permiso que falta → texto legible", async () => {
    const down = await callTool("send_request", { to: "m2", message: "x" }, deps(fakeClient({ createDraft: unreachable() }).client));
    expect(down.isError).toBe(true);
    expect(down.content[0]!.text).toContain("No se pudo conectar");
    const perm = new DeviApiError(403, { error: "x", code: "missing_perm", perm: "files.send" });
    const r = await callTool("send_request", { to: "m2", message: "x" }, deps(fakeClient({ createDraft: perm }).client));
    expect(r.content[0]!.text).toContain('Te falta el permiso "files.send"');
  });
});

test("respond_to_request crea un borrador de respuesta", async () => {
  const f = fakeClient({ createDraft: DRAFT });
  const r = await callTool("respond_to_request", { request_id: "q1", message: "Lo reviso ahora" }, deps(f.client));
  expect(r.isError).toBe(false);
  expect(f.drafts[0]!.meta).toEqual({ kind: "response", sessionId: "s1", requestId: "q1", message: "Lo reviso ahora" });
  expect(r.content[0]!.text).toStartWith("Respuesta preparada");
});

test("sin configuración, todas las herramientas lo explican", async () => {
  const r = await callTool("list_teammates", {}, deps(null));
  expect(r).toEqual({ content: [{ type: "text", text: "Devi no está configurado: falta la URL del servidor." }], isError: true });
});
