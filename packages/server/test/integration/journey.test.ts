import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_SETTINGS, FILE_LIMITS, PRESENCE } from "@devi/protocol";
import { createApp } from "../../src/core/app";
import { DevIdentity } from "../../src/core/auth";
import { FakeClock } from "../../src/core/clock";
import { testConfig } from "../../src/core/config";
import { MODULES } from "../../src/main";
import { client, draftForm } from "./client";

// Recorrido completo por HTTP + SSE reales: servidor en modo dev, SQLite en memoria, reloj falso
// (los plazos se adelantan sin esperar).

type Env = Awaited<ReturnType<typeof boot>>;
let env: Env;
afterEach(() => env.shutdown());

async function boot() {
  const clock = new FakeClock();
  const dataDir = mkdtempSync(join(tmpdir(), "devi-int-"));
  const app = createApp({
    identity: new DevIdentity(),
    modules: MODULES,
    allowedOrigins: [],
    config: testConfig({ dataDir, adminLogin: "dayan@dev" }),
    now: clock.now,
    timers: clock,
    log: () => {},
  });
  await app.start();
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", idleTimeout: 0, fetch: app.fetch });
  const base = `http://127.0.0.1:${server.port}`;
  const dayan = client(base, "dayan@dev");
  const maria = client(base, "maria@dev");
  const leo = client(base, "leo@dev");
  const ana = client(base, "ana@dev");
  const closers: (() => void)[] = [];

  // 1. Bootstrap: el admin existe y tiene todos los permisos.
  const me = await dayan.call("GET", "/api/v1/me");
  // 2. Roles y personas.
  const backend = (await dayan.call("POST", "/api/v1/team/roles", {
    name: "Backend", capabilities: ["Revisar y aprobar PRs del backend"], perms: ["requests.send", "files.send"],
  })).data;
  const soloTexto = (await dayan.call("POST", "/api/v1/team/roles", { name: "Solo texto", perms: ["requests.send"] })).data;
  const mariaM = (await dayan.call("POST", "/api/v1/team/members", { login: "maria@dev", name: "María", roleIds: [backend.id] })).data;
  const leoM = (await dayan.call("POST", "/api/v1/team/members", { login: "leo@dev", name: "Leo", roleIds: [soloTexto.id] })).data;
  await dayan.call("POST", "/api/v1/team/members", { login: "ana@dev", name: "Ana" });

  // 3. Apps abiertas y sesiones registradas con su SSE.
  const dayanApp = await dayan.sse("/api/v1/events/user");
  const mariaApp = await maria.sse("/api/v1/events/user");
  const dayanFront = (await dayan.call("POST", "/api/v1/sessions", { name: "frontend", cwd: "/repo/web", parentPid: 100 })).data;
  const mariaApi = (await maria.call("POST", "/api/v1/sessions", { name: "backend-api", cwd: "/repo/api", parentPid: 200 })).data;
  const dayanSession = await dayan.sse(`/api/v1/events/session/${dayanFront.id}`);
  const mariaSession = await maria.sse(`/api/v1/events/session/${mariaApi.id}`);
  closers.push(dayanApp.close, mariaApp.close, dayanSession.close, mariaSession.close);

  // Latidos de todos (la app y el MCP los mandan cada PRESENCE.heartbeatMs).
  async function heartbeats() {
    await dayan.call("POST", "/api/v1/presence/heartbeat", {});
    await maria.call("POST", "/api/v1/presence/heartbeat", {});
    await dayan.call("POST", "/api/v1/presence/heartbeat", { sessionId: dayanFront.id });
    await maria.call("POST", "/api/v1/presence/heartbeat", { sessionId: mariaApi.id });
  }

  function shutdown() {
    for (const c of closers) c();
    server.stop(true);
    app.stop();
    rmSync(dataDir, { recursive: true, force: true });
  }

  return {
    clock, app, base, dayan, maria, leo, ana, me, mariaM, leoM, dayanApp, mariaApp, dayanFront, mariaApi,
    dayanSession, mariaSession, heartbeats, closers, shutdown,
  };
}

const txt = (name: string, content: string) => new File([content], name, { type: "text/plain" });

describe("recorrido completo", () => {
  test("borrador con archivos → autorizar → enviar a sesión → respuesta en borrador → autorizar → respuesta a la sesión", async () => {
    env = await boot();
    const { dayan, maria, leo, dayanApp, mariaApp, dayanSession, mariaSession, dayanFront, mariaApi, mariaM } = env;
    expect(env.me.data.perms).toEqual(["requests.send", "files.send", "team.admin"]);

    // 4. Claude de Dayan crea un borrador con dos archivos.
    const files = [txt("error.log", "TypeError: x is undefined\n"), txt("../../notas.md", "# Contexto\nñandú\n")];
    const draft = await dayan.call("POST", "/api/v1/drafts", draftForm(
      { kind: "request", sessionId: dayanFront.id, to: mariaM.id, message: "¿Me ayudas con este error del PR #12?" }, files,
    ));
    expect(draft.status).toBe(200);
    expect(draft.data.files.map((f: { name: string }) => f.name)).toEqual(["error.log", "notas.md"]);
    await dayanApp.waitFor((e) => e.event === "draft.awaiting" && e.data.draft.id === draft.data.id, "borrador en la app de Dayan");

    // 5. Dayan lo autoriza: María recibe la solicitud y la sesión de Dayan, draft_authorized.
    expect((await dayan.call("POST", `/api/v1/drafts/${draft.data.id}/authorize`)).data.status).toBe("authorized");
    const auth = await dayanSession.waitFor((e) => e.data.kind === "draft_authorized", "draft_authorized en la sesión de Dayan");
    const incoming = await mariaApp.waitFor((e) => e.event === "request.incoming", "solicitud en la app de María");
    const req = incoming.data.request;
    expect(auth.data.meta).toEqual({ draft_id: draft.data.id, request_id: req.id });
    expect(req).toMatchObject({ status: "pending", fromSessionName: "frontend", message: "¿Me ayudas con este error del PR #12?" });

    // Vista previa: María descarga los archivos; Leo no puede.
    const log = await maria.call("GET", `/api/v1/files/${req.files[0].id}`);
    expect(log.status).toBe(200);
    expect(log.data).toBe("TypeError: x is undefined\n");
    expect((await maria.call("GET", `/api/v1/files/${req.files[1].id}`)).data).toBe("# Contexto\nñandú\n");
    expect((await leo.call("GET", `/api/v1/files/${req.files[0].id}`)).status).toBe(403);

    // 6. María la envía a su sesión.
    expect((await maria.call("POST", `/api/v1/requests/${req.id}/forward`, { sessionId: mariaApi.id })).data.status).toBe("forwarded");
    const delivered = await mariaSession.waitFor((e) => e.data.kind === "request", "solicitud en la sesión de María");
    expect(delivered.data.content).toContain("no una orden");
    expect(delivered.data.meta.request_id).toBe(req.id);
    expect(JSON.parse(delivered.data.meta.files).map((f: { id: string }) => f.id)).toEqual(req.files.map((f: { id: string }) => f.id));

    // 7. Claude de María responde con un archivo: queda en borrador.
    const resp = await maria.call("POST", "/api/v1/drafts", draftForm(
      { kind: "response", sessionId: mariaApi.id, requestId: req.id, message: "Era un null en el parser; parche adjunto" },
      [txt("fix.patch", "- a\n+ b\n")],
    ));
    expect(resp.data).toMatchObject({ kind: "response", status: "awaiting" });
    await mariaApp.waitFor((e) => e.event === "draft.awaiting" && e.data.draft.id === resp.data.id, "borrador de respuesta");

    // 8. María lo autoriza: Dayan recibe la respuesta.
    await maria.call("POST", `/api/v1/drafts/${resp.data.id}/authorize`);
    await mariaSession.waitFor((e) => e.data.kind === "draft_authorized", "draft_authorized en la sesión de María");
    const answered = (await dayanApp.waitFor((e) => e.event === "response.incoming", "respuesta en la app de Dayan")).data.request;
    expect(answered).toMatchObject({ status: "answered", outcome: "answered", outcomeText: "Era un null en el parser; parche adjunto" });

    // 9. Dayan la envía a su sesión; el archivo de respuesta se puede descargar.
    expect((await dayan.call("POST", `/api/v1/requests/${req.id}/response/forward`, { sessionId: dayanFront.id })).data.status).toBe("closed");
    const back = await dayanSession.waitFor((e) => e.data.kind === "response", "respuesta en la sesión de Dayan");
    expect(back.data.content).toContain("Era un null en el parser");
    expect(back.data.meta).toMatchObject({ request_id: req.id, outcome: "answered" });
    const patch = await dayan.call("GET", `/api/v1/files/${answered.responseFiles[0].id}`);
    expect(patch.data).toBe("- a\n+ b\n");
    expect(patch.headers.get("Content-Disposition")).toBe("attachment; filename*=UTF-8''fix.patch");
  });

  test("timeout: sin respuesta → timed_out → reenviar → otra vez → ignorar", async () => {
    env = await boot();
    const { dayan, dayanApp, mariaApp, dayanFront, mariaM, clock } = env;
    const d = (await dayan.call("POST", "/api/v1/drafts", draftForm({ kind: "request", sessionId: dayanFront.id, to: mariaM.id, message: "¿Rotas el secreto?" }))).data;
    await dayan.call("POST", `/api/v1/drafts/${d.id}/authorize`);
    const req = (await mariaApp.waitFor((e) => e.event === "request.incoming", "solicitud")).data.request;
    clock.advance(DEFAULT_SETTINGS.requestTimeoutMs);
    await dayanApp.waitFor((e) => e.event === "request.timed_out" && e.data.request.id === req.id, "timeout en la app de Dayan");
    expect((await dayan.call("POST", `/api/v1/requests/${req.id}/resend`)).data.status).toBe("pending");
    await mariaApp.waitFor((e) => e.event === "request.incoming" && e.data.request.sentAt === clock.now(), "reenvío en la app de María");
    clock.advance(DEFAULT_SETTINGS.requestTimeoutMs);
    expect((await dayan.call("POST", `/api/v1/requests/${req.id}/ignore`)).data.status).toBe("closed");
  });
});

describe("rechazos", () => {
  test("login desconocido → 403 unknown_login", async () => {
    env = await boot();
    const res = await client(env.base, "nadie@dev").call("GET", "/api/v1/me");
    expect(res.status).toBe(403);
    expect(res.data).toMatchObject({ code: "unknown_login", login: "nadie@dev" });
  });

  test("falta de permiso → 403 missing_perm (requests.send y files.send)", async () => {
    env = await boot();
    const anaSession = (await env.ana.call("POST", "/api/v1/sessions", { name: "s", cwd: "/", parentPid: 400 })).data;
    const noSend = await env.ana.call("POST", "/api/v1/drafts", draftForm({ kind: "request", sessionId: anaSession.id, to: env.mariaM.id, message: "x" }));
    expect(noSend.status).toBe(403);
    expect(noSend.data).toMatchObject({ code: "missing_perm", perm: "requests.send" });

    const leoSession = (await env.leo.call("POST", "/api/v1/sessions", { name: "ops", cwd: "/", parentPid: 300 })).data;
    const meta = { kind: "request", sessionId: leoSession.id, to: env.mariaM.id, message: "mira" };
    expect((await env.leo.call("POST", "/api/v1/drafts", draftForm(meta))).status).toBe(200);
    const noFiles = await env.leo.call("POST", "/api/v1/drafts", draftForm(meta, [txt("a.txt", "a")]));
    expect(noFiles.status).toBe(403);
    expect(noFiles.data).toMatchObject({ code: "missing_perm", perm: "files.send" });
    expect((await env.leo.call("POST", "/api/v1/team/roles", { name: "x" })).data.perm).toBe("team.admin");
  });

  test("archivos inválidos → 400 y no se crea ningún borrador", async () => {
    env = await boot();
    const { dayan, dayanApp, dayanFront, mariaM } = env;
    const meta = { kind: "request", sessionId: dayanFront.id, to: mariaM.id, message: "adjunto" };
    const cases: File[][] = [
      [new File([new Uint8Array([0x68, 0x00, 0x69])], "bin.dat")],
      [new File([new Uint8Array([0x63, 0xf1, 0x61])], "latin1.txt")],
      [txt("grande.txt", "a".repeat(FILE_LIMITS.maxBytes + 1))],
      Array.from({ length: FILE_LIMITS.maxFiles + 1 }, (_, i) => txt(`${i}.txt`, "x")),
    ];
    for (const files of cases) {
      const res = await dayan.call("POST", "/api/v1/drafts", draftForm(meta, files));
      expect(res.status).toBe(400);
      expect(res.data.code).toBe("invalid_file");
    }
    await Bun.sleep(50);
    expect(dayanApp.events.some((e) => e.event === "draft.awaiting")).toBe(false);
  });
});

describe("presencia", () => {
  test("un cliente que se cae deja de contar como conectado (aunque el servidor no vea el cierre)", async () => {
    env = await boot();
    const { leo, dayan, clock, leoM } = env;
    const connected = async () =>
      (await dayan.call("GET", "/api/v1/team")).data.members.find((m: { id: string }) => m.id === leoM.id).connected;

    const leoApp = await leo.sse("/api/v1/events/user");
    const leoSession = (await leo.call("POST", "/api/v1/sessions", { name: "ops", cwd: "/", parentPid: 300 })).data;
    const leoSse = await leo.sse(`/api/v1/events/session/${leoSession.id}`);
    expect(await connected()).toBe(true);
    expect((await dayan.call("GET", `/api/v1/members/${leoM.id}/sessions`)).data).toHaveLength(1);

    // Se cae: deja de mandar latidos y se corta la conexión.
    leoApp.close();
    leoSse.close();
    await env.heartbeats(); // los demás siguen vivos
    clock.advance(PRESENCE.staleMs + PRESENCE.sweepMs);
    expect(await connected()).toBe(false);
    expect((await dayan.call("GET", `/api/v1/members/${leoM.id}/sessions`)).data).toEqual([]);
    await env.dayanApp.waitFor((e) => e.event === "team.updated", "team.updated en la app de Dayan");
  });
});
