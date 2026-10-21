// Prueba de integración: dos "Claude Code falsos" (clientes MCP por stdio que lanzan `devi mcp`)
// y dos "apps falsas" (@devi/client) contra un servidor real en modo dev (proceso aparte).
// Recorre: list_teammates → send_request con archivo → autorizar → forward → request en el canal
// con ruta local → respond_to_request (con archivo) → autorizar → forward → response en el canal.
// Todo vive en carpetas temporales; el servidor y los MCP se matan en afterAll.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createClient, type DeviClient } from "@devi/client";
import type { UserEvent } from "@devi/protocol";
import { z } from "zod";

const MAIN = join(import.meta.dir, "../src/main.ts");
const SERVER_MAIN = join(import.meta.dir, "../../server/src/main.ts");
const ChannelEvent = z.object({
  method: z.literal("notifications/claude/channel"),
  params: z.object({ content: z.string(), meta: z.record(z.string(), z.string()) }),
});
type ChannelMsg = z.infer<typeof ChannelEvent>["params"];

async function waitFor<T>(fn: () => T | undefined | Promise<T | undefined>, what: string, ms = 10_000): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v !== undefined) return v;
    await Bun.sleep(100);
  }
  throw new Error(`timeout esperando: ${what}`);
}

const tmp = mkdtempSync(join(tmpdir(), "devi-smoke-"));
const port = 20_000 + Math.floor(Math.random() * 20_000);
const serverUrl = `http://127.0.0.1:${port}`;
let serverProc: ReturnType<typeof Bun.spawn> | null = null;
const closers: (() => void | Promise<void>)[] = [];
const heartbeats = new Set<() => Promise<unknown>>();
let beat: ReturnType<typeof setInterval> | null = null;

afterAll(async () => {
  if (beat) clearInterval(beat);
  for (const c of closers.reverse()) await Promise.resolve(c()).catch(() => {});
  serverProc?.kill();
  await serverProc?.exited;
  rmSync(tmp, { recursive: true, force: true });
});

// "Claude Code falso": lanza `devi mcp` con su propia config, carpeta de proyecto y carpeta de recibidos.
async function fakeClaude(login: string, session: string, home: string) {
  const project = join(home, "proyecto");
  mkdirSync(project, { recursive: true });
  const config = join(home, "config.json");
  const receivedDir = join(home, "recibidos");
  writeFileSync(config, JSON.stringify({ serverUrl, devUser: login, receivedDir }));
  const events: ChannelMsg[] = [];
  const client = new Client({ name: "smoke", version: "0" });
  client.setNotificationHandler(ChannelEvent, async (n) => {
    events.push(n.params);
  });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [MAIN, "mcp"],
    cwd: project,
    env: { ...process.env, HOME: home, DEVI_CONFIG: config, DEVI_SESSION: session, CLAUDE_PROJECT_DIR: project } as Record<string, string>,
    stderr: "pipe",
  });
  closers.push(() => client.close());
  await client.connect(transport);
  const callTool = async (name: string, args: Record<string, unknown> = {}) => {
    const r = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
    return { text: r.content.map((c) => c.text).join("\n"), isError: !!r.isError };
  };
  const nextEvent = (kind: string) => waitFor(() => events.find((e) => e.meta.kind === kind), `evento ${kind} en ${session}`);
  return { project, receivedDir, callTool, nextEvent };
}

// "App falsa": guarda los eventos SSE de usuario.
function fakeApp(app: DeviClient) {
  const events: UserEvent[] = [];
  closers.push(app.subscribeUser((e) => events.push(e)));
  const next = <T extends UserEvent["type"]>(type: T, pred: (e: Extract<UserEvent, { type: T }>) => boolean = () => true) =>
    waitFor(() => events.find((e): e is Extract<UserEvent, { type: T }> => e.type === type && pred(e as Extract<UserEvent, { type: T }>)), `evento de usuario ${type}`);
  return { events, next };
}

beforeAll(async () => {
  serverProc = Bun.spawn(
    [process.execPath, SERVER_MAIN, "--dev", "--port", String(port), "--data-dir", join(tmp, "data"), "--admin", "dayan@dev"],
    { stdout: "ignore", stderr: "ignore", env: { ...process.env, HOME: tmp } },
  );
  await waitFor(async () => {
    try {
      return (await fetch(`${serverUrl}/api/v1/health`)).status > 0 ? true : undefined;
    } catch {
      return undefined;
    }
  }, "servidor arrancado");
}, 30_000);

test("devi mcp: de list_teammates a la respuesta en el canal, con archivos", async () => {
  // Las "apps" mandan Origin como el webview de Devi (las rutas humanas lo exigen); el MCP no.
  const dayanApp = createClient({ baseUrl: serverUrl, devUser: "dayan@dev", origin: "tauri://localhost" });
  const mariaApp = createClient({ baseUrl: serverUrl, devUser: "maria@dev", origin: "tauri://localhost" });

  // Equipo: dayan (admin) y maria, los dos con un rol que puede enviar solicitudes y archivos.
  const role = await dayanApp.call("createRole", {
    body: { name: "Dev", color: "#4a7bd8", capabilities: ["Aprobar PRs backend"], perms: ["requests.send", "files.send"] },
  });
  const meDayan = await dayanApp.call("me");
  await dayanApp.call("updateMember", { params: { id: meDayan.member.id }, body: { roleIds: [...meDayan.member.roleIds, role.id] } });
  const maria = await dayanApp.call("createMember", {
    body: { login: "maria@dev", name: "María", description: "Backend", roleIds: [role.id] },
  });

  const dayanUi = fakeApp(dayanApp);
  const mariaUi = fakeApp(mariaApp);
  const dayan = await fakeClaude("dayan@dev", "frontend", join(tmp, "dayan"));
  const mariaCc = await fakeClaude("maria@dev", "backend-api", join(tmp, "maria"));

  // Presencia: el cliente aún no manda latidos solo, así que los mandamos desde el test.
  const sessionOf = (memberId: string) =>
    waitFor(async () => (await dayanApp.call("memberSessions", { params: { id: memberId } }))[0], `sesión de ${memberId}`);
  const mariaSession = await sessionOf(maria.id);
  const dayanSession = await sessionOf(meDayan.member.id);
  expect([mariaSession.name, dayanSession.name]).toEqual(["backend-api", "frontend"]);
  heartbeats.add(() => dayanApp.call("heartbeat", { body: {} }));
  heartbeats.add(() => mariaApp.call("heartbeat", { body: {} }));
  heartbeats.add(() => dayanApp.call("heartbeat", { body: { sessionId: dayanSession.id } }));
  heartbeats.add(() => mariaApp.call("heartbeat", { body: { sessionId: mariaSession.id } }));
  const tick = () => Promise.all([...heartbeats].map((h) => h().catch(() => {})));
  await tick();
  beat = setInterval(tick, 2000);

  const team = await waitFor(async () => {
    const t = await dayan.callTool("list_teammates");
    return t.text.includes("María") ? t : undefined;
  }, "maria en list_teammates");
  expect(team.text).toContain("Aprobar PRs backend");
  expect(team.text).not.toContain('"Dayan"');

  writeFileSync(join(dayan.project, "nota.txt"), "el PR es el #12");
  const sent = await dayan.callTool("send_request", { to: maria.id, message: "¿me apruebas el PR?", files: ["nota.txt"] });
  expect(sent.isError).toBe(false);
  expect(sent.text).toContain("esperando autorización en la app de Devi");

  const awaiting = await dayanUi.next("draft.awaiting");
  await dayanApp.call("authorizeDraft", { params: { id: awaiting.draft.id } });
  await dayan.nextEvent("draft_authorized");

  const incoming = await mariaUi.next("request.incoming");
  expect(incoming.request.files[0]?.name).toBe("nota.txt");
  await mariaApp.call("forwardRequest", { params: { id: incoming.request.id }, body: { sessionId: mariaSession.id } });
  const req = await mariaCc.nextEvent("request");
  const localPath = join(mariaCc.receivedDir, incoming.request.id, "nota.txt");
  expect(req.meta.request_id).toBe(incoming.request.id);
  expect(req.content).toContain(localPath);
  expect(readFileSync(localPath, "utf8")).toBe("el PR es el #12");

  writeFileSync(join(mariaCc.project, "resultado.txt"), "PR aprobado, sin cambios");
  const answered = await mariaCc.callTool("respond_to_request", {
    request_id: incoming.request.id, message: "Aprobado", files: ["resultado.txt"],
  });
  expect(answered.isError).toBe(false);
  const mariaDraft = await mariaUi.next("draft.awaiting", (e) => e.draft.kind === "response");
  await mariaApp.call("authorizeDraft", { params: { id: mariaDraft.draft.id } });
  await mariaCc.nextEvent("draft_authorized");

  const response = await dayanUi.next("response.incoming");
  await dayanApp.call("forwardResponse", { params: { id: response.request.id }, body: { sessionId: dayanSession.id } });
  const resp = await dayan.nextEvent("response");
  expect(resp.content).toContain("Aprobado");
  const respPath = join(dayan.receivedDir, incoming.request.id, "respuesta", "resultado.txt");
  expect(resp.content).toContain(respPath);
  expect(readFileSync(respPath, "utf8")).toBe("PR aprobado, sin cambios");
}, 60_000);
