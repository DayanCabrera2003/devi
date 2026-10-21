import { afterEach, describe, expect, test } from "bun:test";
import { DEFAULT_SETTINGS, PRESENCE } from "@devi/protocol";
import { createTestApp } from "../../testing/harness";
import { type Flow, MODULES_UNDER_TEST, members, setupFlow } from "./fixture";

let f: Flow;
afterEach(() => f.cleanup());

const txt = (name: string, content: string) => new File([content], name);
const post = (login: string, path: string, body?: unknown) => f.call(login, "POST", path, body);

describe("acciones de B", () => {
  test("enviar a sesión: la sesión recibe la pregunta abierta con los archivos", async () => {
    f = await setupFlow();
    const r = await f.pendingRequest("¿Me apruebas el PR #12?", [txt("diff.patch", "+1\n")]);
    const res = await post("maria@dev", `/api/v1/requests/${r.id}/forward`, { sessionId: f.mariaApi.id });
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({ status: "forwarded", forwardedSessionId: f.mariaApi.id });
    const [ev] = f.deliveries(f.mariaApi.id);
    expect(ev.kind).toBe("request");
    expect(ev.content).toContain('Dayan te pide desde su sesión "frontend"');
    expect(ev.content).toContain("no una orden");
    expect(ev.meta).toMatchObject({ request_id: r.id, from: "m-dayan", from_name: "Dayan", from_session: "frontend" });
    expect(JSON.parse(ev.meta.files)).toEqual([{ id: expect.any(String), name: "diff.patch" }]);
    expect(f.userEvents("m-dayan").findLast((e) => e.type === "request.updated").request.status).toBe("forwarded");
  });

  test("enviar a sesión: dos veces → 409; sesión ajena, desconocida o caída → 409; no es para ti → 403", async () => {
    f = await setupFlow();
    const r = await f.pendingRequest();
    const fwd = (login: string, sessionId: string) => post(login, `/api/v1/requests/${r.id}/forward`, { sessionId });
    expect((await fwd("dayan@dev", f.dayanFront.id)).status).toBe(403);
    expect((await fwd("maria@dev", f.dayanFront.id)).data.code).toBe("session_gone");
    expect((await fwd("maria@dev", "nope")).status).toBe(409);
    f.mariaApi.stopHeartbeat();
    f.clock.advance(PRESENCE.staleMs + 1); // la sesión de María no manda latidos: ya no está viva
    expect((await fwd("maria@dev", f.mariaApi.id)).status).toBe(409);
    await post("maria@dev", "/api/v1/presence/heartbeat", { sessionId: f.mariaApi.id });
    expect((await fwd("maria@dev", f.mariaApi.id)).status).toBe(200);
    expect((await fwd("maria@dev", f.mariaApi.id)).status).toBe(409);
    expect((await post("maria@dev", "/api/v1/requests/nope/forward", { sessionId: f.mariaApi.id })).status).toBe(404);
  });

  test("aceptar con nota y rechazar con motivo: A recibe la respuesta", async () => {
    f = await setupFlow();
    const a = await f.pendingRequest("¿Me das acceso al bucket?");
    const acc = await post("maria@dev", `/api/v1/requests/${a.id}/accept`, { note: "  lo hago en 10 min " });
    expect(acc.data).toMatchObject({ status: "accepted", outcome: "accepted", outcomeText: "lo hago en 10 min" });
    expect(f.userEvents("m-dayan").findLast((e) => e.type === "response.incoming").request.id).toBe(a.id);
    expect((await post("maria@dev", `/api/v1/requests/${a.id}/accept`, {})).status).toBe(409);

    const b = await f.pendingRequest("¿Rotas el secreto?");
    expect((await post("maria@dev", `/api/v1/requests/${b.id}/reject`, { reason: " " })).status).toBe(400);
    const rej = await post("maria@dev", `/api/v1/requests/${b.id}/reject`, { reason: "No tengo permisos, pídeselo a Leo" });
    expect(rej.data).toMatchObject({ status: "rejected", outcomeText: "No tengo permisos, pídeselo a Leo" });
    expect((await post("dayan@dev", `/api/v1/requests/${b.id}/reject`, { reason: "x" })).status).toBe(403);
  });
});

describe("acciones de A sobre la respuesta", () => {
  test("aceptar la respuesta la cierra sin enviar nada a ninguna sesión", async () => {
    f = await setupFlow();
    const r = await f.pendingRequest();
    await post("maria@dev", `/api/v1/requests/${r.id}/accept`, {});
    const closed: string[] = [];
    f.app.ctx.bus.on("request.closed", ({ requestId }) => closed.push(requestId));
    expect((await post("maria@dev", `/api/v1/requests/${r.id}/response/accept`)).status).toBe(403);
    const res = await post("dayan@dev", `/api/v1/requests/${r.id}/response/accept`);
    expect(res.data).toMatchObject({ status: "closed", outcome: "accepted" });
    expect(closed).toEqual([r.id]);
    expect(f.deliveries(f.dayanFront.id).some((d) => d.kind === "response")).toBe(false);
    expect((await post("dayan@dev", `/api/v1/requests/${r.id}/response/accept`)).status).toBe(409);
  });

  test("enviar la respuesta a su sesión: texto de la respuesta y archivos", async () => {
    f = await setupFlow();
    const r = await f.forwardedRequest();
    const d = (await f.responseDraft(r.id, "Lo reviso y lo apruebo si pasan los tests", [txt("notas.md", "ok\n")])).data;
    await post("maria@dev", `/api/v1/drafts/${d.id}/authorize`);
    expect((await post("dayan@dev", `/api/v1/requests/${r.id}/response/forward`, { sessionId: f.mariaApi.id })).status).toBe(409);
    const res = await post("dayan@dev", `/api/v1/requests/${r.id}/response/forward`, { sessionId: f.dayanFront.id });
    expect(res.data.status).toBe("closed");
    const ev = f.deliveries(f.dayanFront.id).find((x) => x.kind === "response");
    expect(ev.content).toContain("María respondió a tu solicitud");
    expect(ev.content).toContain("Lo reviso y lo apruebo si pasan los tests");
    expect(ev.meta).toMatchObject({ request_id: r.id, from: "m-maria", outcome: "answered" });
    expect(JSON.parse(ev.meta.files).map((x: { name: string }) => x.name)).toEqual(["notas.md"]);
  });

  test("sin respuesta abierta → 409", async () => {
    f = await setupFlow();
    const r = await f.pendingRequest();
    expect((await post("dayan@dev", `/api/v1/requests/${r.id}/response/accept`)).status).toBe(409);
  });
});

describe("plazos", () => {
  test("pending → timed_out → resend → pending con plazo nuevo → timed_out → ignore → closed", async () => {
    f = await setupFlow();
    const r = await f.pendingRequest();
    f.clock.advance(DEFAULT_SETTINGS.requestTimeoutMs - 1);
    expect(f.userEvents("m-dayan").some((e) => e.type === "request.timed_out")).toBe(false);
    f.clock.advance(1);
    expect(f.userEvents("m-dayan").find((e) => e.type === "request.timed_out").request.status).toBe("timed_out");
    expect((await post("maria@dev", `/api/v1/requests/${r.id}/accept`, {})).status).toBe(409);
    expect((await post("maria@dev", `/api/v1/requests/${r.id}/resend`)).status).toBe(403);

    const before = f.userEvents("m-maria").filter((e) => e.type === "request.incoming").length;
    const again = await post("dayan@dev", `/api/v1/requests/${r.id}/resend`);
    expect(again.data).toMatchObject({ status: "pending", sentAt: f.clock.now(), deadline: f.clock.now() + DEFAULT_SETTINGS.requestTimeoutMs });
    expect(f.userEvents("m-maria").filter((e) => e.type === "request.incoming").length).toBe(before + 1);
    expect((await post("dayan@dev", `/api/v1/requests/${r.id}/resend`)).status).toBe(409);

    f.clock.advance(DEFAULT_SETTINGS.requestTimeoutMs);
    expect((await post("dayan@dev", `/api/v1/requests/${r.id}/ignore`)).data.status).toBe("closed");
    expect((await post("dayan@dev", `/api/v1/requests/${r.id}/ignore`)).status).toBe(409);
  });

  test("forwarded sin respuesta también vence", async () => {
    f = await setupFlow();
    const r = await f.forwardedRequest();
    f.clock.advance(DEFAULT_SETTINGS.requestTimeoutMs);
    expect(f.userEvents("m-dayan").find((e) => e.type === "request.timed_out").request.id).toBe(r.id);
  });

  test("el timeout sale de settings", async () => {
    f = await setupFlow();
    await f.call("dayan@dev", "PATCH", "/api/v1/settings", { requestTimeoutMs: 60_000 });
    await f.pendingRequest();
    f.clock.advance(60_000);
    expect(f.userEvents("m-dayan").some((e) => e.type === "request.timed_out")).toBe(true);
  });

  test("tras un reinicio: borradores caducados se descartan y plazos vencidos vencen", async () => {
    f = await setupFlow();
    const d = (await f.requestDraft("borrador")).data;
    const r = await f.pendingRequest("pendiente");
    f.app.stop();
    f.clock.advance(DEFAULT_SETTINGS.requestTimeoutMs + 1); // el servidor estuvo apagado
    const t2 = createTestApp({ modules: MODULES_UNDER_TEST, db: f.app.ctx.db, clock: f.clock, dataDir: f.dataDir });
    await t2.app.start();
    expect(t2.userEvents("m-dayan")).toContainEqual({ type: "draft.discarded", draftId: d.id });
    expect(t2.userEvents("m-dayan").find((e) => e.type === "request.timed_out").request.id).toBe(r.id);
    t2.app.stop();
  });

  test("tras un reinicio: los plazos futuros se reprograman", async () => {
    f = await setupFlow();
    const r = await f.pendingRequest();
    f.app.stop();
    const t2 = createTestApp({ modules: MODULES_UNDER_TEST, db: f.app.ctx.db, clock: f.clock, dataDir: f.dataDir });
    await t2.app.start();
    f.clock.advance(DEFAULT_SETTINGS.requestTimeoutMs);
    expect(t2.userEvents("m-dayan").find((e) => e.type === "request.timed_out").request.id).toBe(r.id);
    t2.app.stop();
  });
});

describe("reinicio con borrador de respuesta", () => {
  test("el plazo pausado sobrevive a restore() y se reanuda completo al descartar", async () => {
    f = await setupFlow();
    (f.app.ctx.services.get("settings") as any).update({ requestTimeoutMs: 60_000 });
    const r = await f.forwardedRequest();
    const d = (await f.responseDraft(r.id)).data;
    f.app.stop();
    const t2 = createTestApp({ modules: MODULES_UNDER_TEST, db: f.app.ctx.db, clock: f.clock, dataDir: f.dataDir });
    await t2.app.start();
    f.clock.advance(10 * 60_000); // muy pasado el plazo original (1 min), pero con borrador esperando
    expect(t2.userEvents("m-dayan").some((e) => e.type === "request.timed_out")).toBe(false);
    expect((await t2.call("maria@dev", "POST", `/api/v1/drafts/${d.id}/discard`)).status).toBe(200);
    const updated = t2.userEvents("m-maria").findLast((e) => e.type === "request.updated");
    expect(updated.request).toMatchObject({ status: "forwarded", deadline: f.clock.now() + 60_000 });
    f.clock.advance(59_999);
    expect(t2.userEvents("m-dayan").some((e) => e.type === "request.timed_out")).toBe(false);
    f.clock.advance(1);
    expect(t2.userEvents("m-dayan").some((e) => e.type === "request.timed_out")).toBe(true);
    t2.app.stop();
  });
});

describe("reenviar", () => {
  test("si el destinatario ya no está activo → 409 y sigue timed_out", async () => {
    f = await setupFlow();
    const r = await f.pendingRequest();
    f.clock.advance(DEFAULT_SETTINGS.requestTimeoutMs);
    const maria = members.find((m) => m.id === "m-maria")!;
    maria.disabled = true;
    try {
      const res = await post("dayan@dev", `/api/v1/requests/${r.id}/resend`);
      expect(res.status).toBe(409);
      expect(res.data.error).toContain("ya no está en el equipo");
    } finally {
      maria.disabled = false;
    }
    expect((await post("dayan@dev", `/api/v1/requests/${r.id}/resend`)).status).toBe(200);
  });
});

describe("app", () => {
  test("al conectar recibe las tarjetas abiertas (como hoy)", async () => {
    f = await setupFlow();
    const a = await f.pendingRequest("aceptada");
    await post("maria@dev", `/api/v1/requests/${a.id}/accept`, {});
    const t = await f.pendingRequest("vencerá");
    await post("maria@dev", `/api/v1/requests/${t.id}/forward`, { sessionId: f.mariaApi.id });
    f.clock.advance(DEFAULT_SETTINGS.requestTimeoutMs);
    const p = await f.pendingRequest("pendiente");

    const nM = f.userEvents("m-maria").length;
    await f.openStream("maria@dev", "/api/v1/events/user");
    const maria = f.userEvents("m-maria").slice(nM).filter((e) => e.type !== "team.updated");
    expect(maria.map((e) => [e.type, e.request?.id])).toEqual([["request.incoming", p.id]]);

    const nD = f.userEvents("m-dayan").length;
    await f.openStream("dayan@dev", "/api/v1/events/user");
    const dayan = f.userEvents("m-dayan").slice(nD).filter((e) => e.type !== "team.updated");
    expect(dayan.map((e) => [e.type, e.request?.id])).toEqual([
      ["response.incoming", a.id],
      ["request.timed_out", t.id],
    ]);
  });

  test("debugPush (solo admin) entrega a las sesiones vivas", async () => {
    f = await setupFlow();
    const res = await post("dayan@dev", "/api/v1/debug/push", { memberId: "m-maria", content: "hola" });
    expect(res.data).toEqual({ delivered: 1 });
    expect(f.deliveries(f.mariaApi.id).at(-1)).toEqual({ kind: "debug", content: "hola", meta: {} });
    expect((await post("maria@dev", "/api/v1/debug/push", {})).status).toBe(403);
  });
});

describe("la sesión desaparece", () => {
  test("cerrada con la solicitud reenviada: vuelve a pending con plazo nuevo y aviso a B", async () => {
    f = await setupFlow();
    const r = await f.forwardedRequest();
    f.clock.advance(10 * 60_000);
    const before = f.userEvents("m-maria").length;
    await f.call("maria@dev", "DELETE", `/api/v1/sessions/${f.mariaApi.id}`);
    const ev = f.userEvents("m-maria").slice(before).findLast((e) => e.type === "request.updated");
    expect(ev.request).toMatchObject({ id: r.id, status: "pending", deadline: f.clock.now() + DEFAULT_SETTINGS.requestTimeoutMs });
    expect(ev.request.forwardedSessionId).toBeUndefined();
    // el plazo nuevo corre: vence a su hora y no antes
    f.clock.advance(DEFAULT_SETTINGS.requestTimeoutMs - 1);
    expect(f.userEvents("m-dayan").some((e) => e.type === "request.timed_out")).toBe(false);
    f.clock.advance(1);
    expect(f.userEvents("m-dayan").some((e) => e.type === "request.timed_out")).toBe(true);
  });

  test("sin latidos (obsoleta): también vuelve a pending", async () => {
    f = await setupFlow();
    const r = await f.forwardedRequest();
    f.mariaApi.stopHeartbeat();
    f.clock.advance(PRESENCE.staleMs + PRESENCE.sweepMs);
    const ev = f.userEvents("m-maria").findLast((e) => e.type === "request.updated" && e.request.id === r.id);
    expect(ev.request.status).toBe("pending");
  });

  test("con borrador de respuesta esperando no se toca la solicitud", async () => {
    f = await setupFlow();
    const r = await f.forwardedRequest();
    await f.responseDraft(r.id);
    await f.call("maria@dev", "DELETE", `/api/v1/sessions/${f.mariaApi.id}`);
    const ev = f.userEvents("m-maria").findLast((e) => e.type === "request.updated" && e.request.id === r.id);
    expect(ev.request.status).toBe("forwarded");
  });

  test("otra sesión de B no afecta", async () => {
    f = await setupFlow();
    const r = await f.forwardedRequest();
    const other = await f.session("maria@dev", "otra", 999);
    await f.call("maria@dev", "DELETE", `/api/v1/sessions/${other.id}`);
    const ev = f.userEvents("m-maria").findLast((e) => e.type === "request.updated" && e.request.id === r.id);
    expect(ev.request.status).toBe("forwarded");
  });

  test("sin la sesión del autor no se entregan draft_authorized ni draft_discarded", async () => {
    f = await setupFlow();
    const d1 = (await f.requestDraft("uno")).data;
    const d2 = (await f.requestDraft("dos")).data;
    await f.call("dayan@dev", "DELETE", `/api/v1/sessions/${f.dayanFront.id}`);
    const before = f.deliveries(f.dayanFront.id).length;
    expect((await f.call("dayan@dev", "POST", `/api/v1/drafts/${d1.id}/authorize`)).status).toBe(200);
    expect((await f.call("dayan@dev", "POST", `/api/v1/drafts/${d2.id}/discard`)).status).toBe(200);
    expect(f.deliveries(f.dayanFront.id).length).toBe(before);
  });
});

describe("tope de cuerpo JSON", () => {
  test("más de 64 KB en una ruta JSON → 413", async () => {
    f = await setupFlow();
    const r = await f.pendingRequest();
    const res = await post("maria@dev", `/api/v1/requests/${r.id}/reject`, { reason: "x".repeat(70_000) });
    expect(res.status).toBe(413);
  });
});

describe("request.updated a las dos partes en cada transición", () => {
  const updates = (memberId: string, id: string) =>
    f.userEvents(memberId).filter((e) => e.type === "request.updated" && e.request.id === id).map((e) => e.request.status);

  test("forward, accept, reject, answered, resend, ignore, closed", async () => {
    f = await setupFlow();
    // forward + accept
    const a = await f.pendingRequest("a");
    await post("maria@dev", `/api/v1/requests/${a.id}/forward`, { sessionId: f.mariaApi.id });
    for (const who of ["m-dayan", "m-maria"]) expect(updates(who, a.id)).toContain("forwarded");
    const b = await f.pendingRequest("b");
    await post("maria@dev", `/api/v1/requests/${b.id}/accept`, {});
    for (const who of ["m-dayan", "m-maria"]) expect(updates(who, b.id)).toContain("accepted");
    await post("dayan@dev", `/api/v1/requests/${b.id}/response/accept`);
    for (const who of ["m-dayan", "m-maria"]) expect(updates(who, b.id)).toContain("closed");
    // reject
    const c = await f.pendingRequest("c");
    await post("maria@dev", `/api/v1/requests/${c.id}/reject`, { reason: "no" });
    for (const who of ["m-dayan", "m-maria"]) expect(updates(who, c.id)).toContain("rejected");
    // answered (por borrador de respuesta)
    const d = (await f.responseDraft(a.id)).data;
    await post("maria@dev", `/api/v1/drafts/${d.id}/authorize`);
    for (const who of ["m-dayan", "m-maria"]) expect(updates(who, a.id)).toContain("answered");
    // timed_out → resend → ignore
    const e = await f.pendingRequest("e");
    f.clock.advance(DEFAULT_SETTINGS.requestTimeoutMs);
    await post("dayan@dev", `/api/v1/requests/${e.id}/resend`);
    for (const who of ["m-dayan", "m-maria"]) expect(updates(who, e.id).filter((s) => s === "pending").length).toBeGreaterThan(0);
    f.clock.advance(DEFAULT_SETTINGS.requestTimeoutMs);
    await post("dayan@dev", `/api/v1/requests/${e.id}/ignore`);
    for (const who of ["m-dayan", "m-maria"]) expect(updates(who, e.id)).toContain("closed");
  });
});

describe("descarga de archivos de borradores", () => {
  test("el autor de un borrador awaiting o autorizado puede descargar; el destinatario solo tras autorizar", async () => {
    f = await setupFlow();
    const d = (await f.requestDraft("x", [txt("plan.md", "# plan\n")])).data;
    const url = `/api/v1/files/${d.files[0].id}`;
    const own = await f.call("dayan@dev", "GET", url);
    expect(own.status).toBe(200);
    expect(own.data).toBe("# plan\n");
    expect((await f.call("maria@dev", "GET", url)).status).toBe(403);
    await post("dayan@dev", `/api/v1/drafts/${d.id}/authorize`);
    expect((await f.call("dayan@dev", "GET", url)).status).toBe(200);
    expect((await f.call("maria@dev", "GET", url)).status).toBe(200);
  });
});

describe("repetición al conectar la app", () => {
  test("borradores awaiting y tarjetas abiertas del mismo usuario", async () => {
    f = await setupFlow();
    const r = await f.pendingRequest("vencerá");
    f.clock.advance(DEFAULT_SETTINGS.requestTimeoutMs); // timed_out: tarjeta abierta de Dayan
    const draft = (await f.requestDraft("otro")).data; // borrador awaiting de Dayan
    const before = f.userEvents("m-dayan").length;
    await f.openStream("dayan@dev", "/api/v1/events/user");
    const replay = f.userEvents("m-dayan").slice(before).filter((e) => e.type !== "team.updated");
    expect(replay.map((e) => [e.type, e.draft?.id ?? e.request?.id])).toEqual([
      ["draft.awaiting", draft.id],
      ["request.timed_out", r.id],
    ]);
  });
});
