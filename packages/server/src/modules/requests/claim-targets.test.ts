import { describe, expect, test } from "bun:test";
import type { AuditEntry } from "@devi/protocol";
import type { Access } from "../../core/auth";
import { auditModule } from "../audit/index";
import { claimsModule } from "../claims/index";
import { setupFlow } from "./fixture";

// María recibe la solicitud de Dayan y la manda a una sesión nueva con un código.
async function setup() {
  const f = await setupFlow({ extraModules: [claimsModule, auditModule] });
  const claim = (login: string, target: object) => f.call(login, "POST", "/api/v1/claims", { target });
  // Sesión nueva (registrada como el MCP, sin abrir aún su SSE) y canje desde su hook.
  const newSession = async (login = "maria@dev", parentPid = 900) =>
    (await f.call(login, "POST", "/api/v1/sessions", { name: "nueva", cwd: "/n", parentPid, machine: "" }, { origin: null })).data;
  const redeem = (code: string, login = "maria@dev", parentPid = 900) =>
    f.call(login, "POST", "/api/v1/claims/redeem", { code, claudeSessionId: `cx-${parentPid}`, parentPid, machine: "" }, { origin: null });
  const inbox = (login: string, parentPid: number) =>
    f.call(login, "GET", `/api/v1/sessions/inbox?parentPid=${parentPid}&claudeSessionId=cx-${parentPid}`, undefined, { origin: null });
  const audit = async (): Promise<AuditEntry[]> => (await f.call("dayan@dev", "GET", "/api/v1/audit?limit=200")).data.entries;
  const claimEvents = (memberId: string, code: string) =>
    f.userEvents(memberId).filter((e) => e.type === "claim.updated" && e.claim.code === code).map((e) => e.claim.status);
  const requestEvents = (id: string) => f.sent.filter((s) => s.data?.request?.id === id).length;
  return { ...f, claim, newSession, redeem, inbox, audit, claimEvents, requestEvents };
}

describe("solicitud a una sesión nueva", () => {
  test("queda forwarded a la sesión nueva, en su bandeja, sin empujarla por el canal, con auditoría", async () => {
    const f = await setup();
    const r = await f.pendingRequest("¿Revisas el PR?");
    const before = f.requestEvents(r.id);
    const { code } = (await f.claim("maria@dev", { type: "request", id: r.id })).data;
    // Crear el código no cambia nada: ningún evento nuevo de la solicitud y sigue pending.
    expect(f.requestEvents(r.id)).toBe(before);
    expect((await f.getRequest(r.id)).status).toBe("pending");
    const s = await f.newSession();
    const res = await f.redeem(code);
    expect(res.status).toBe(200);
    expect(res.data.delivery.kind).toBe("request");
    expect(res.data.delivery.meta.request_id).toBe(r.id);
    expect(res.data.delivery.content).toContain("¿Revisas el PR?");
    const after = await f.getRequest(r.id);
    expect(after.status).toBe("forwarded");
    expect(after.forwardedSessionId).toBe(s.id);
    expect(f.deliveries(s.id)).toHaveLength(0); // no se empujó por el canal
    const box = (await f.inbox("maria@dev", 900)).data;
    expect(box).toHaveLength(1);
    expect(box[0]).toMatchObject({ kind: "request", content: res.data.delivery.content, meta: { request_id: r.id } });
    const entry = (await f.audit()).find((e) => e.action === "request.forwarded" && e.targetId === r.id);
    expect(entry?.details).toMatchObject({ claimCode: code, sessionId: s.id });
  });

  test("un nuevo registro del mismo Claude Code (mismo pid, sin instanceId) no la devuelve a pending", async () => {
    const f = await setup();
    const r = await f.pendingRequest();
    const { code } = (await f.claim("maria@dev", { type: "request", id: r.id })).data;
    const s = await f.newSession();
    await f.redeem(code);
    // Mismo Claude Code se vuelve a registrar sin instanceId: legacySame lo encuentra y lo actualiza, no lo sustituye.
    await f.call("maria@dev", "POST", "/api/v1/sessions", { name: "nueva", cwd: "/n", parentPid: 900, machine: "" }, { origin: null });
    expect((await f.getRequest(r.id)).status).toBe("forwarded");
    expect((await f.getRequest(r.id)).forwardedSessionId).toBe(s.id);
  });

  test("si mientras tanto la acepta, el canje falla y el código sigue sin usar", async () => {
    const f = await setup();
    const r = await f.pendingRequest();
    const { code } = (await f.claim("maria@dev", { type: "request", id: r.id })).data;
    await f.call("maria@dev", "POST", `/api/v1/requests/${r.id}/accept`, {});
    await f.newSession();
    const res = await f.redeem(code);
    expect(res.status).toBe(409);
    expect(res.data.error).toBe("la solicitud ya está aceptada");
    expect(f.claimEvents("m-maria", code)).not.toContain("used");
    // La reserva se liberó: un segundo canje vuelve a llegar al manejador (no es claim_used).
    const again = await f.redeem(code);
    expect(again.status).toBe(409);
    expect(again.data.code).not.toBe("claim_used");
    expect(again.data.error).toBe("la solicitud ya está aceptada");
  });

  test("Dayan no puede crear un código para una solicitud que no es para él", async () => {
    const f = await setup();
    const r = await f.pendingRequest();
    expect((await f.claim("dayan@dev", { type: "request", id: r.id })).status).toBe(403);
  });

  test("solo entrega a sesiones de quien llama: una sesión de otra persona da session_gone y no cambia nada", async () => {
    const f = await setup();
    const r = await f.pendingRequest();
    const maria: Access = { memberId: "m-maria", perms: new Set() };
    const handler = f.app.ctx.services.get("requestTargets").request!;
    let err: unknown;
    try {
      handler.deliverTo(maria, r.id, f.dayanFront.id, {});
    } catch (e) {
      err = e;
    }
    expect(err).toMatchObject({ status: 409, extra: { code: "session_gone" } });
    expect((await f.getRequest(r.id)).status).toBe("pending");
    // Su bandeja ya tiene el aviso draft_authorized: lo que no puede haber es la solicitud.
    expect((await f.inbox("dayan@dev", 100)).data.filter((d: { kind: string }) => d.kind === "request")).toEqual([]);
  });

  test("traspaso: llega con el contenido de traspaso", async () => {
    const f = await setup();
    const d = (await f.createDraft("dayan@dev", { kind: "request", sessionId: f.dayanFront.id, to: "m-maria", message: "Sigue tú", requestKind: "handoff" })).data;
    await f.call("dayan@dev", "POST", `/api/v1/drafts/${d.id}/authorize`);
    const r = f.userEvents("m-maria").findLast((e) => e.type === "request.incoming").request;
    const { code } = (await f.claim("maria@dev", { type: "request", id: r.id })).data;
    await f.newSession();
    const res = await f.redeem(code);
    expect(res.data.delivery.meta.request_kind).toBe("handoff");
  });
});

describe("respuesta a una sesión nueva", () => {
  async function answered() {
    const f = await setup();
    const r = await f.forwardedRequest();
    const rd = (await f.responseDraft(r.id)).data;
    await f.call("maria@dev", "POST", `/api/v1/drafts/${rd.id}/authorize`);
    return { f, r };
  }

  test("Dayan manda la respuesta a una sesión nueva suya: la solicitud se cierra", async () => {
    const { f, r } = await answered();
    const { code } = (await f.claim("dayan@dev", { type: "response", id: r.id })).data;
    const s = await f.newSession("dayan@dev", 950);
    const res = await f.redeem(code, "dayan@dev", 950);
    expect(res.status).toBe(200);
    expect(res.data.delivery.kind).toBe("response");
    expect(res.data.delivery.meta).toMatchObject({ request_id: r.id, outcome: "answered" });
    expect(f.deliveries(s.id)).toHaveLength(0);
    expect((await f.inbox("dayan@dev", 950)).data).toHaveLength(1);
    expect((await f.getRequest(r.id)).status).toBe("closed");
  });

  test("con la respuesta ya cerrada, el canje da conflicto", async () => {
    const { f, r } = await answered();
    const { code } = (await f.claim("dayan@dev", { type: "response", id: r.id })).data;
    await f.call("dayan@dev", "POST", `/api/v1/requests/${r.id}/response/accept`, {});
    await f.newSession("dayan@dev", 950);
    const res = await f.redeem(code, "dayan@dev", 950);
    expect(res.status).toBe(409);
    expect(res.data.error).toBe("no hay respuesta abierta (estado: cerrada)");
  });
});
