import { afterEach, describe, expect, test } from "bun:test";
import { PRESENCE } from "@devi/protocol";
import { createTestApp, stubTeamModule } from "../../testing/harness";
import { SESSION_PRUNE_MS } from "./service";
import { sessionsModule } from "./index";

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

const register = (login: string, name: string, parentPid: number) =>
  t.call(login, "POST", "/api/v1/sessions", { name, cwd: `/repo/${name}`, parentPid });
const sessionsOf = async (memberId: string) => (await t.call("dayan@dev", "GET", `/api/v1/members/${memberId}/sessions`)).data;

describe("sesiones", () => {
  test("registrar no la hace viva; abrir su SSE sí; cerrarlo, no", async () => {
    await setup();
    const s = (await register("dayan@dev", "frontend", 100)).data;
    expect(s).toMatchObject({ memberId: "m-dayan", name: "frontend", cwd: "/repo/frontend", status: "idle" });
    expect(await sessionsOf("m-dayan")).toEqual([]);
    const stream = await t.openStream("dayan@dev", `/api/v1/events/session/${s.id}`);
    expect(stream.status).toBe(200);
    expect((await sessionsOf("m-dayan")).map((x: { id: string }) => x.id)).toEqual([s.id]);
    expect(t.userEvents("m-dayan")).toContainEqual({ type: "sessions.updated", memberId: "m-dayan" });
    stream.close();
    expect(await sessionsOf("m-dayan")).toEqual([]);
  });

  test("channel: se guarda al registrar (por defecto false) y se expone en la sesión", async () => {
    await setup();
    const a = (await register("dayan@dev", "frontend", 100)).data;
    expect(a.channel).toBe(false);
    const b = (await t.call("dayan@dev", "POST", "/api/v1/sessions", { name: "api", cwd: "/r", parentPid: 200, channel: true })).data;
    expect(b.channel).toBe(true);
    await t.openStream("dayan@dev", `/api/v1/events/session/${b.id}`);
    expect((await sessionsOf("m-dayan"))[0]).toMatchObject({ id: b.id, channel: true });
  });

  test("el SSE de una sesión ajena → 403; desconocida → 404", async () => {
    await setup();
    const s = (await register("dayan@dev", "frontend", 100)).data;
    expect((await t.openStream("maria@dev", `/api/v1/events/session/${s.id}`)).status).toBe(403);
    expect((await t.openStream("dayan@dev", "/api/v1/events/session/nope")).status).toBe(404);
  });

  test("registrar de nuevo con el mismo nombre y pid devuelve la misma sesión (reconexión del MCP)", async () => {
    await setup();
    const a = (await register("dayan@dev", "frontend", 100)).data;
    const stream = await t.openStream("dayan@dev", `/api/v1/events/session/${a.id}`);
    const again = (await t.call("dayan@dev", "POST", "/api/v1/sessions", { name: "frontend", cwd: "/otro", parentPid: 100 })).data;
    expect(again.id).toBe(a.id);
    expect(again.cwd).toBe("/otro");
    expect((await sessionsOf("m-dayan")).map((x: { id: string }) => x.id)).toEqual([a.id]);
    stream.close();
  });

  test("mismo Claude Code (pid) sustituye a la anterior; el mismo nombre en otro Claude Code, no", async () => {
    await setup();
    const a = (await register("dayan@dev", "frontend", 100)).data;
    const b = (await register("dayan@dev", "frontend", 200)).data;
    // Claude Code relanza su MCP (otro proceso, otro instanceId): sustituye a la del mismo pid.
    const c = (await t.call("dayan@dev", "POST", "/api/v1/sessions", { name: "otra", cwd: "/r", parentPid: 200, instanceId: "nuevo" })).data;
    expect(b.name).toBe("frontend (2)");
    expect((await t.openStream("dayan@dev", `/api/v1/events/session/${a.id}`)).status).toBe(200);
    expect((await t.openStream("dayan@dev", `/api/v1/events/session/${b.id}`)).status).toBe(404);
    expect((await t.openStream("dayan@dev", `/api/v1/events/session/${c.id}`)).status).toBe(200);
  });

  test("hook: empareja por pid padre y guarda claude_session_id; luego también por ese id", async () => {
    await setup();
    const s = (await register("dayan@dev", "frontend", 100)).data;
    await t.openStream("dayan@dev", `/api/v1/events/session/${s.id}`);
    const hook = (status: string, parentPid: number, claudeSessionId = "cs-1") =>
      t.call("dayan@dev", "POST", "/api/v1/sessions/hook", { claudeSessionId, cwd: "/repo", parentPid, status });
    expect((await hook("working", 100)).data).toEqual({ ok: true });
    expect((await sessionsOf("m-dayan"))[0].status).toBe("working");
    await hook("idle", 999); // otro pid, mismo claude_session_id
    expect((await sessionsOf("m-dayan"))[0].status).toBe("idle");
    expect((await hook("working", 555, "otra")).data).toEqual({ ok: true }); // sin pareja: se ignora
    expect((await sessionsOf("m-dayan"))[0].status).toBe("idle");
  });

  test("cerrar: solo el dueño", async () => {
    await setup();
    const s = (await register("dayan@dev", "frontend", 100)).data;
    expect((await t.call("maria@dev", "DELETE", `/api/v1/sessions/${s.id}`)).status).toBe(403);
    expect((await t.call("dayan@dev", "DELETE", `/api/v1/sessions/${s.id}`)).data).toEqual({ ok: true });
    expect((await t.call("dayan@dev", "DELETE", `/api/v1/sessions/${s.id}`)).status).toBe(404);
  });

  test("sin latidos, una sesión con el SSE abierto deja de estar viva (cliente caído)", async () => {
    await setup();
    const s = (await register("dayan@dev", "frontend", 100)).data;
    await t.openStream("dayan@dev", `/api/v1/events/session/${s.id}`); // nunca se cierra
    t.clock.advance(PRESENCE.staleMs - 1_000);
    await t.call("dayan@dev", "POST", "/api/v1/presence/heartbeat", { sessionId: s.id });
    t.clock.advance(PRESENCE.staleMs - 1_000);
    expect(await sessionsOf("m-dayan")).toHaveLength(1);
    t.clock.advance(PRESENCE.sweepMs + 2_000);
    expect(await sessionsOf("m-dayan")).toEqual([]);
    const updates = t.userEvents("m-dayan").filter((e) => e.type === "sessions.updated");
    expect(updates.length).toBeGreaterThanOrEqual(3); // registro, abrir, caer
  });

  test("latido de una sesión ajena → 403; latido de la app marca al usuario", async () => {
    await setup();
    const s = (await register("dayan@dev", "frontend", 100)).data;
    expect((await t.call("maria@dev", "POST", "/api/v1/presence/heartbeat", { sessionId: s.id })).status).toBe(403);
    expect((await t.call("maria@dev", "POST", "/api/v1/presence/heartbeat", {})).data).toEqual({ ok: true });
  });

  test("poda: sesiones muertas y sin señales en 24 h se borran", async () => {
    await setup();
    const s = (await register("dayan@dev", "frontend", 100)).data;
    t.clock.advance(SESSION_PRUNE_MS + 3_600_000);
    expect((await t.openStream("dayan@dev", `/api/v1/events/session/${s.id}`)).status).toBe(404);
  });
});

describe("cerrar o sustituir una sesión cierra su SSE", () => {
  test("DELETE cierra el stream y avisa por el bus", async () => {
    await setup();
    const s = (await register("dayan@dev", "frontend", 100)).data;
    await t.openStream("dayan@dev", `/api/v1/events/session/${s.id}`);
    const closed: string[] = [];
    t.app.ctx.bus.on("session.closed", ({ sessionId }) => closed.push(sessionId));
    expect(t.app.ctx.sse.isOpen(`session:${s.id}`)).toBe(true);
    await t.call("dayan@dev", "DELETE", `/api/v1/sessions/${s.id}`);
    expect(t.app.ctx.sse.isOpen(`session:${s.id}`)).toBe(false);
    expect(closed).toContain(s.id);
  });

  test("sustituirla (mismo Claude Code, otro MCP) cierra el stream de la anterior", async () => {
    await setup();
    const a = (await register("dayan@dev", "frontend", 100)).data;
    await t.openStream("dayan@dev", `/api/v1/events/session/${a.id}`);
    await t.call("dayan@dev", "POST", "/api/v1/sessions", { name: "frontend", cwd: "/r", parentPid: 100, instanceId: "nuevo" });
    expect(t.app.ctx.sse.isOpen(`session:${a.id}`)).toBe(false);
  });

  test("session.closed también al quedar sin latidos (obsoleta)", async () => {
    await setup();
    const s = (await register("dayan@dev", "frontend", 100)).data;
    await t.openStream("dayan@dev", `/api/v1/events/session/${s.id}`);
    const closed: string[] = [];
    t.app.ctx.bus.on("session.closed", ({ sessionId }) => closed.push(sessionId));
    t.clock.advance(PRESENCE.staleMs + PRESENCE.sweepMs);
    expect(closed).toEqual([s.id]);
  });
});
