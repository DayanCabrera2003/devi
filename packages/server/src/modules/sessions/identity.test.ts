import { afterEach, describe, expect, test } from "bun:test";
import { PRESENCE } from "@devi/protocol";
import { createTestApp, stubTeamModule } from "../../testing/harness";
import { sessionsModule } from "./index";

// Identidad de las sesiones: una persona (login de Tailscale → miembro) puede tener varias sesiones de
// Claude Code a la vez, en la misma máquina o en varias. Ninguna debe pisar, suplantar ni recibir lo de otra.

const team = stubTeamModule([
  { id: "m-dayan", login: "dayan@dev", name: "Dayan", disabled: false, perms: ["requests.send"] },
  { id: "m-maria", login: "maria@dev", name: "María", disabled: false, perms: [] },
]);

let t: ReturnType<typeof createTestApp>;
afterEach(() => t.cleanup());

async function setup() {
  t = createTestApp({ modules: [team, sessionsModule] });
  await t.app.start();
  return t;
}

type Reg = { name: string; parentPid: number; machine?: string; instanceId?: string; claudeSessionId?: string; cwd?: string };
const agent = { origin: null };
const register = (login: string, r: Reg) =>
  t.call(login, "POST", "/api/v1/sessions", { cwd: r.cwd ?? `/repo/${r.name}`, ...r }, agent);
// Registra y abre el SSE (sesión viva), como hace el MCP.
async function live(login: string, r: Reg) {
  const res = await register(login, r);
  expect(res.status).toBe(200);
  const s = res.data as { id: string; name: string };
  await t.openStream(login, `/api/v1/events/session/${s.id}`);
  return s;
}
const liveOf = async (memberId: string) =>
  ((await t.call("dayan@dev", "GET", `/api/v1/members/${memberId}/sessions`)).data as { id: string; name: string; status: string }[]);
const hook = (login: string, h: { parentPid: number; machine?: string; claudeSessionId?: string; status?: string }) =>
  t.call(login, "POST", "/api/v1/sessions/hook", { cwd: "/repo/api", claudeSessionId: "cs-?", status: "working", ...h }, agent);
const statusOf = async (id: string) => (await liveOf("m-dayan")).find((s) => s.id === id)?.status;

describe("nombres de sesión", () => {
  test("dos sesiones de la misma persona en la misma carpeta conviven: api y api (2)", async () => {
    await setup();
    const a = await live("dayan@dev", { name: "api", parentPid: 100, machine: "M1", instanceId: "i-a" });
    const b = await live("dayan@dev", { name: "api", parentPid: 200, machine: "M1", instanceId: "i-b" });
    const c = await live("dayan@dev", { name: "api", parentPid: 300, machine: "M2", instanceId: "i-c" });
    expect([a.name, b.name, c.name]).toEqual(["api", "api (2)", "api (3)"]);
    expect((await liveOf("m-dayan")).map((s) => s.id).sort()).toEqual([a.id, b.id, c.id].sort());
  });

  test("el nombre se reparte por persona: otra persona puede tener también api", async () => {
    await setup();
    await live("dayan@dev", { name: "api", parentPid: 100, instanceId: "i-a" });
    const m = await live("maria@dev", { name: "api", parentPid: 100, instanceId: "i-m" });
    expect(m.name).toBe("api");
  });

  test("cuando la sesión api se cierra, la siguiente vuelve a llamarse api", async () => {
    await setup();
    const a = await live("dayan@dev", { name: "api", parentPid: 100, instanceId: "i-a" });
    await t.call("dayan@dev", "DELETE", `/api/v1/sessions/${a.id}`, undefined, agent);
    const b = await live("dayan@dev", { name: "api", parentPid: 200, instanceId: "i-b" });
    expect(b.name).toBe("api");
  });

  test("al volver a registrarse (mismo instanceId) conserva su id y su nombre", async () => {
    await setup();
    const a = await live("dayan@dev", { name: "api", parentPid: 100, instanceId: "i-a" });
    const b = await live("dayan@dev", { name: "api", parentPid: 200, instanceId: "i-b" });
    const again = (await register("dayan@dev", { name: "api", parentPid: 200, instanceId: "i-b", cwd: "/otra" })).data;
    expect(again).toMatchObject({ id: b.id, name: "api (2)", cwd: "/otra" });
    expect((await liveOf("m-dayan")).map((s) => s.id).sort()).toEqual([a.id, b.id].sort());
  });
});

describe("sustitución de sesiones", () => {
  test("mismo Claude Code (máquina y pid) con otro MCP: sustituye a la anterior", async () => {
    await setup();
    const a = await live("dayan@dev", { name: "api", parentPid: 100, machine: "M1", instanceId: "i-a" });
    const b = await live("dayan@dev", { name: "api", parentPid: 100, machine: "M1", instanceId: "i-b" });
    expect(b.name).toBe("api");
    expect((await liveOf("m-dayan")).map((s) => s.id)).toEqual([b.id]);
    expect(t.app.ctx.sse.isOpen(`session:${a.id}`)).toBe(false);
  });

  test("el MCP sustituido no puede volver a registrarse y quitarle el sitio al nuevo (409 session_replaced)", async () => {
    await setup();
    await live("dayan@dev", { name: "api", parentPid: 100, machine: "M1", instanceId: "i-a" });
    const b = await live("dayan@dev", { name: "api", parentPid: 100, machine: "M1", instanceId: "i-b" });
    const res = await register("dayan@dev", { name: "api", parentPid: 100, machine: "M1", instanceId: "i-a" });
    expect(res.status).toBe(409);
    expect(res.data.code).toBe("session_replaced");
    expect((await liveOf("m-dayan")).map((s) => s.id)).toEqual([b.id]);
  });

  test("el mismo pid en OTRA máquina de la misma persona no sustituye nada", async () => {
    await setup();
    const a = await live("dayan@dev", { name: "api", parentPid: 100, machine: "M1", instanceId: "i-a" });
    const b = await live("dayan@dev", { name: "web", parentPid: 100, machine: "M2", instanceId: "i-b" });
    expect((await liveOf("m-dayan")).map((s) => s.id).sort()).toEqual([a.id, b.id].sort());
  });

  test("el mismo pid de OTRA persona no sustituye nada", async () => {
    await setup();
    const a = await live("dayan@dev", { name: "api", parentPid: 100, machine: "M1", instanceId: "i-a" });
    await live("maria@dev", { name: "api", parentPid: 100, machine: "M1", instanceId: "i-m" });
    expect((await liveOf("m-dayan")).map((s) => s.id)).toEqual([a.id]);
  });

  test("un MCP antiguo (sin instanceId ni máquina) se reconecta a la misma sesión por su pid", async () => {
    await setup();
    const a = await live("dayan@dev", { name: "api", parentPid: 100 });
    const again = (await register("dayan@dev", { name: "api", parentPid: 100 })).data;
    expect(again.id).toBe(a.id);
  });
});

describe("hooks: cada uno actualiza SOLO su sesión", () => {
  test("dos sesiones en la misma carpeta: el hook de cada Claude Code va a la suya", async () => {
    await setup();
    const a = await live("dayan@dev", { name: "api", parentPid: 100, machine: "M1", instanceId: "i-a" });
    const b = await live("dayan@dev", { name: "api", parentPid: 200, machine: "M1", instanceId: "i-b" });
    await hook("dayan@dev", { parentPid: 100, machine: "M1", claudeSessionId: "cs-a", status: "working" });
    expect(await statusOf(a.id)).toBe("working");
    expect(await statusOf(b.id)).toBe("idle");
    await hook("dayan@dev", { parentPid: 200, machine: "M1", claudeSessionId: "cs-b", status: "working" });
    await hook("dayan@dev", { parentPid: 100, machine: "M1", claudeSessionId: "cs-a", status: "idle" });
    expect(await statusOf(a.id)).toBe("idle");
    expect(await statusOf(b.id)).toBe("working");
  });

  test("el pid de una sesión ya muerta (reutilizado tras reiniciar) no la empareja", async () => {
    await setup();
    const a = await live("dayan@dev", { name: "api", parentPid: 100, machine: "M1", instanceId: "i-a" });
    t.clock.advance(PRESENCE.staleMs + PRESENCE.sweepMs + 1_000); // sin latidos: muerta
    expect(await liveOf("m-dayan")).toEqual([]);
    expect((await hook("dayan@dev", { parentPid: 100, machine: "M1", claudeSessionId: "cs-nuevo" })).data).toEqual({ ok: true });
    const rec = t.app.ctx.services.get("sessions").get(a.id);
    expect(rec?.status).toBe("idle"); // no se tocó
    const inbox = await t.call("dayan@dev", "GET", "/api/v1/sessions/inbox?parentPid=100&machine=M1&claudeSessionId=cs-nuevo", undefined, agent);
    expect(inbox.data).toEqual([]);
  });

  test("el mismo pid en otra máquina no empareja", async () => {
    await setup();
    const a = await live("dayan@dev", { name: "api", parentPid: 100, machine: "M1", instanceId: "i-a" });
    await hook("dayan@dev", { parentPid: 100, machine: "M2", claudeSessionId: "cs-x", status: "working" });
    expect(await statusOf(a.id)).toBe("idle");
  });

  test("sin pareja por pid (hook lanzado a través de otro proceso), empareja por el claudeSessionId que dio el MCP", async () => {
    await setup();
    const a = await live("dayan@dev", { name: "api", parentPid: 100, machine: "M1", instanceId: "i-a", claudeSessionId: "cs-a" });
    const b = await live("dayan@dev", { name: "api", parentPid: 200, machine: "M1", instanceId: "i-b", claudeSessionId: "cs-b" });
    await hook("dayan@dev", { parentPid: 999, machine: "M1", claudeSessionId: "cs-b", status: "working" });
    expect(await statusOf(a.id)).toBe("idle");
    expect(await statusOf(b.id)).toBe("working");
  });

  test("el pid manda sobre un claudeSessionId heredado por otra sesión (Claude Code dentro de Claude Code)", async () => {
    await setup();
    // La sesión hija heredó por error el CLAUDE_CODE_SESSION_ID de la madre.
    const madre = await live("dayan@dev", { name: "api", parentPid: 100, machine: "M1", instanceId: "i-a" });
    const hija = await live("dayan@dev", { name: "api", parentPid: 200, machine: "M1", instanceId: "i-b", claudeSessionId: "cs-madre" });
    await hook("dayan@dev", { parentPid: 100, machine: "M1", claudeSessionId: "cs-madre", status: "working" });
    expect(await statusOf(madre.id)).toBe("working");
    expect(await statusOf(hija.id)).toBe("idle");
  });

  test("un hook de otra persona nunca toca mis sesiones", async () => {
    await setup();
    const a = await live("dayan@dev", { name: "api", parentPid: 100, machine: "M1", instanceId: "i-a", claudeSessionId: "cs-a" });
    await hook("maria@dev", { parentPid: 100, machine: "M1", claudeSessionId: "cs-a", status: "working" });
    expect(await statusOf(a.id)).toBe("idle");
  });

  test("/clear o /resume en el mismo Claude Code: el pid vuelve a emparejar y guarda el nuevo claudeSessionId", async () => {
    await setup();
    const a = await live("dayan@dev", { name: "api", parentPid: 100, machine: "M1", instanceId: "i-a", claudeSessionId: "cs-1" });
    await hook("dayan@dev", { parentPid: 100, machine: "M1", claudeSessionId: "cs-2", status: "working" });
    expect(await statusOf(a.id)).toBe("working");
    // Ahora un hook sin pid conocido con cs-2 también llega a ella.
    await hook("dayan@dev", { parentPid: 999, machine: "M1", claudeSessionId: "cs-2", status: "idle" });
    expect(await statusOf(a.id)).toBe("idle");
  });
});
