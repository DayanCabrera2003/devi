import { afterEach, describe, expect, test } from "bun:test";
import { DEFAULT_SETTINGS } from "@devi/protocol";
import type { FakeClock } from "../../core/clock";
import { createTestApp } from "../../testing/harness";
import { auditModule } from "../audit/index";
import { type Flow, MODULES_UNDER_TEST, setupFlow } from "./fixture";

let f: Flow;
afterEach(() => f.cleanup());

const MIN = 60_000;
const ESCALATE = DEFAULT_SETTINGS.escalateAfterMs!;
const txt = (name: string, content: string) => new File([content], name);
const post = (login: string, path: string, body?: unknown) => f.call(login, "POST", path, body);
const agent = { origin: null };

// Freno contra bucles: un temporizador que se reprograma para el mismo instante haría girar
// FakeClock.advance para siempre. Con este tope el test falla en vez de llenar la RAM.
function guardTimers(clock: FakeClock, max = 500): void {
  const after = clock.after.bind(clock);
  let n = 0;
  clock.after = (ms, fn) => {
    if (++n > max) throw new Error(`más de ${max} temporizadores programados: ¿bucle?`);
    return after(ms, fn);
  };
}

async function setup(opts: Parameters<typeof setupFlow>[0] = {}) {
  f = await setupFlow(opts);
  guardTimers(f.clock);
  return f;
}

const escalations = (sessionId: string) => f.deliveries(sessionId).filter((d) => d.kind === "escalation");
const escalatedEvents = (memberId: string) => f.userEvents(memberId).filter((e) => e.type === "request.escalated");

describe("escalado con plazo", () => {
  test("sin respuesta al cumplirse el plazo: aviso a la sesión autora y evento a su app, una sola vez", async () => {
    await setup();
    const r = await f.pendingRequest("¿Me apruebas el PR #12?");
    f.clock.advance(ESCALATE - 1);
    expect(escalations(f.dayanFront.id)).toHaveLength(0);
    f.clock.advance(1);
    const [d] = escalations(f.dayanFront.id);
    expect(d).toBeDefined();
    expect(d.meta).toMatchObject({ request_id: r.id, to: "m-maria", to_name: "María" });
    expect(d.content).toContain("María");
    expect(d.content).toContain("list_teammates");
    expect(d.content).toContain("30 min");
    const [ev] = escalatedEvents("m-dayan");
    expect(ev.request).toMatchObject({ id: r.id, status: "pending", escalatedAt: f.clock.now() });
    expect(escalatedEvents("m-maria")).toHaveLength(0); // solo al autor
    // No se repite: ni con más tiempo ni tras el timeout y un reenvío.
    f.clock.advance(DEFAULT_SETTINGS.requestTimeoutMs);
    await post("dayan@dev", `/api/v1/requests/${r.id}/resend`);
    f.clock.advance(ESCALATE * 2);
    expect(escalations(f.dayanFront.id)).toHaveLength(1);
    expect(escalatedEvents("m-dayan")).toHaveLength(1);
  });

  test("queda en la bandeja de la sesión (entrega sin canal)", async () => {
    await setup();
    const r = await f.pendingRequest();
    f.clock.advance(ESCALATE);
    const inbox = await f.call("dayan@dev", "GET", "/api/v1/sessions/inbox?parentPid=100&claudeSessionId=x", undefined, agent);
    expect(inbox.data).toContainEqual(expect.objectContaining({ kind: "escalation", meta: expect.objectContaining({ request_id: r.id }) }));
  });

  test("si el destinatario actuó (reenviar, aceptar, rechazar), no hay aviso", async () => {
    await setup();
    const a = await f.pendingRequest("a");
    const b = await f.pendingRequest("b");
    const c = await f.pendingRequest("c");
    await post("maria@dev", `/api/v1/requests/${a.id}/forward`, { sessionId: f.mariaApi.id });
    await post("maria@dev", `/api/v1/requests/${b.id}/accept`, {});
    await post("maria@dev", `/api/v1/requests/${c.id}/reject`, { reason: "no" });
    f.clock.advance(ESCALATE);
    expect(escalations(f.dayanFront.id)).toHaveLength(0);
    expect(escalatedEvents("m-dayan")).toHaveLength(0);
  });

  test("desactivado (null) no avisa; el plazo sale de settings", async () => {
    await setup();
    await f.call("dayan@dev", "PATCH", "/api/v1/settings", { escalateAfterMs: null });
    await f.pendingRequest("sin aviso");
    f.clock.advance(ESCALATE);
    expect(escalations(f.dayanFront.id)).toHaveLength(0);

    await f.call("dayan@dev", "PATCH", "/api/v1/settings", { escalateAfterMs: 10 * MIN });
    const r = await f.pendingRequest("con aviso");
    f.clock.advance(10 * MIN);
    expect(escalations(f.dayanFront.id).map((d) => d.meta.request_id)).toEqual([r.id]);
  });

  test("enviada desde la app (sin sesión): solo el evento a la app", async () => {
    await setup();
    const form = f.draftForm({ to: "m-maria", message: "desde la app" });
    const r = (await post("dayan@dev", "/api/v1/requests", form)).data;
    f.clock.advance(ESCALATE);
    expect(escalations(f.dayanFront.id)).toHaveLength(0);
    expect(escalatedEvents("m-dayan").map((e) => e.request.id)).toEqual([r.id]);
  });

  test("tras un reinicio: el plazo se reprograma y, si ya venció, avisa al arrancar (una vez)", async () => {
    await setup();
    const future = await f.pendingRequest("futuro");
    f.app.stop();
    const t2 = createTestApp({ modules: MODULES_UNDER_TEST, db: f.app.ctx.db, clock: f.clock, dataDir: f.dataDir });
    guardTimers(f.clock);
    await t2.app.start();
    f.clock.advance(ESCALATE);
    expect(t2.userEvents("m-dayan").filter((e) => e.type === "request.escalated").map((e) => e.request.id)).toEqual([future.id]);
    t2.app.stop();

    const t3 = createTestApp({ modules: MODULES_UNDER_TEST, db: f.app.ctx.db, clock: f.clock, dataDir: f.dataDir });
    await t3.app.start();
    f.clock.advance(MIN);
    expect(t3.userEvents("m-dayan").filter((e) => e.type === "request.escalated")).toHaveLength(0);
    t3.app.stop();
  });

  test("con el servidor apagado durante el plazo: avisa al arrancar", async () => {
    await setup();
    const r = await f.pendingRequest();
    f.app.stop();
    f.clock.advance(ESCALATE + MIN);
    const t2 = createTestApp({ modules: MODULES_UNDER_TEST, db: f.app.ctx.db, clock: f.clock, dataDir: f.dataDir });
    await t2.app.start();
    expect(t2.userEvents("m-dayan").filter((e) => e.type === "request.escalated").map((e) => e.request.id)).toEqual([r.id]);
    t2.app.stop();
  });
});

describe("pedírselo a otra persona", () => {
  test("crea una solicitud nueva con el mismo mensaje y archivos y cierra la original con nota", async () => {
    await setup({ extraModules: [auditModule] });
    const r = await f.pendingRequest("¿Me apruebas el PR #12?", [txt("diff.patch", "+1\n")]);
    f.clock.advance(ESCALATE);
    const res = await post("dayan@dev", `/api/v1/requests/${r.id}/reassign`, { to: "m-leo" });
    expect(res.status).toBe(200);
    const { request: next, original } = res.data;
    expect(next).toMatchObject({
      toMemberId: "m-leo", fromMemberId: "m-dayan", fromSessionId: f.dayanFront.id, message: "¿Me apruebas el PR #12?",
      status: "pending", sentAt: f.clock.now(), deadline: f.clock.now() + DEFAULT_SETTINGS.requestTimeoutMs,
    });
    expect(next.id).not.toBe(r.id);
    expect(next.escalatedAt).toBeUndefined();
    expect(next.files.map((x: { name: string }) => x.name)).toEqual(["diff.patch"]);
    expect(next.files[0].id).not.toBe(original.files[0].id); // copia propia (la original se libera al cerrarse)
    expect(original).toMatchObject({ id: r.id, status: "closed", closedNote: "Reenviada a Leo", replacedBy: next.id });

    // Leo la recibe y puede descargar el adjunto; María ve la original cerrada.
    expect(f.userEvents("m-leo").find((e) => e.type === "request.incoming").request.id).toBe(next.id);
    expect((await f.call("leo@dev", "GET", `/api/v1/files/${next.files[0].id}`)).data).toBe("+1\n");
    expect(f.userEvents("m-maria").findLast((e) => e.request?.id === r.id).request.status).toBe("closed");
    expect((await post("maria@dev", `/api/v1/requests/${r.id}/accept`, {})).status).toBe(409);

    const actions = (await f.call("dayan@dev", "GET", "/api/v1/audit?limit=50")).data.entries.map((e: { action: string }) => e.action);
    expect(actions).toContain("request.reassigned");
    expect(actions).toContain("request.escalated");
  });

  test("la solicitud nueva lleva el mismo contexto y el mismo tipo que la original", async () => {
    await setup();
    const context = { summary: "Migrando facturas", urgency: "alta" as const, git: { branch: "feat/facturas" } };
    const d = (await f.createDraft("dayan@dev", { kind: "request", sessionId: f.dayanFront.id, to: "m-maria", message: "¿Lo miras?", context })).data;
    await post("dayan@dev", `/api/v1/drafts/${d.id}/authorize`);
    const r = f.userEvents("m-maria").findLast((e) => e.type === "request.incoming").request;
    const next = (await post("dayan@dev", `/api/v1/requests/${r.id}/reassign`, { to: "m-leo" })).data.request;
    expect(next.context).toEqual(context);
    expect(next.kind).toBe("request");
    expect(f.userEvents("m-leo").find((e) => e.type === "request.incoming").request.context).toEqual(context);
  });

  test("también desde timed_out; la nueva escala por su cuenta", async () => {
    await setup();
    const r = await f.pendingRequest();
    f.clock.advance(DEFAULT_SETTINGS.requestTimeoutMs);
    const next = (await post("dayan@dev", `/api/v1/requests/${r.id}/reassign`, { to: "m-leo" })).data.request;
    f.clock.advance(ESCALATE);
    expect(escalations(f.dayanFront.id).map((d) => d.meta.request_id)).toEqual([r.id, next.id]);
  });

  test("solo el remitente, solo desde la app, solo pending o timed_out, y a otra persona activa", async () => {
    await setup();
    const r = await f.pendingRequest();
    const path = `/api/v1/requests/${r.id}/reassign`;
    expect((await f.call("dayan@dev", "POST", path, { to: "m-leo" }, agent)).data.code).toBe("human_only");
    expect((await post("maria@dev", path, { to: "m-leo" })).status).toBe(403);
    expect((await post("dayan@dev", path, { to: "m-dayan" })).status).toBe(400); // a ti mismo
    expect((await post("dayan@dev", path, { to: "m-maria" })).status).toBe(400); // a la misma persona
    expect((await post("dayan@dev", path, { to: "nadie" })).status).toBe(404);
    expect((await post("dayan@dev", path, {})).status).toBe(400);
    expect((await post("dayan@dev", "/api/v1/requests/nope/reassign", { to: "m-leo" })).status).toBe(404);

    const fwd = await f.forwardedRequest("en su sesión");
    expect((await post("dayan@dev", `/api/v1/requests/${fwd.id}/reassign`, { to: "m-leo" })).status).toBe(409);
    expect((await post("dayan@dev", path, { to: "m-leo" })).status).toBe(200);
    expect((await post("dayan@dev", path, { to: "m-leo" })).status).toBe(409); // ya cerrada
  });

  test("los adjuntos viajan también en solicitudes de otra persona", async () => {
    await setup();
    const d = (await f.createDraft("maria@dev", { kind: "request", sessionId: f.mariaApi.id, to: "m-leo", message: "hola" }, [txt("a.txt", "x")])).data;
    await post("maria@dev", `/api/v1/drafts/${d.id}/authorize`);
    const r = f.userEvents("m-leo").findLast((e) => e.type === "request.incoming").request;
    const ok = await post("maria@dev", `/api/v1/requests/${r.id}/reassign`, { to: "m-dayan" });
    expect(ok.status).toBe(200);
    expect(ok.data.request.files).toHaveLength(1);
  });
});
