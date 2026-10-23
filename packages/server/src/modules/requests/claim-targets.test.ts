import { describe, expect, test } from "bun:test";
import { claimsModule } from "../claims/index";
import { setupFlow } from "./fixture";

// María recibe la solicitud de Dayan y la manda a una sesión nueva con un código.
async function setup() {
  const f = await setupFlow({ extraModules: [claimsModule] });
  const claim = (login: string, target: object) => f.call(login, "POST", "/api/v1/claims", { target });
  // Sesión nueva de María (registrada como el MCP, sin abrir aún su SSE) y canje desde su hook.
  const newSession = async (parentPid = 900) =>
    (await f.call("maria@dev", "POST", "/api/v1/sessions", { name: "nueva", cwd: "/n", parentPid, machine: "" }, { origin: null })).data;
  const redeem = (code: string, parentPid = 900) =>
    f.call("maria@dev", "POST", "/api/v1/claims/redeem", { code, claudeSessionId: "cx", parentPid, machine: "" }, { origin: null });
  return { ...f, claim, newSession, redeem };
}

describe("solicitud a una sesión nueva", () => {
  test("queda forwarded a la sesión nueva, sin empujarla por el canal, con auditoría", async () => {
    const f = await setup();
    const r = await f.pendingRequest("¿Revisas el PR?");
    const { code } = (await f.claim("maria@dev", { type: "request", id: r.id })).data;
    expect((await f.getRequest(r.id))?.status ?? "pending").toBe("pending"); // crear el código no cambia nada
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
    expect(res.data.error).toContain("accepted");
  });

  test("Dayan no puede crear un código para una solicitud que no es para él", async () => {
    const f = await setup();
    const r = await f.pendingRequest();
    expect((await f.claim("dayan@dev", { type: "request", id: r.id })).status).toBe(403);
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
  test("Dayan manda la respuesta a una sesión nueva suya: la solicitud se cierra", async () => {
    const f = await setup();
    const r = await f.forwardedRequest();
    const rd = (await f.responseDraft(r.id)).data;
    await f.call("maria@dev", "POST", `/api/v1/drafts/${rd.id}/authorize`);
    const { code } = (await f.claim("dayan@dev", { type: "response", id: r.id })).data;
    await f.call("dayan@dev", "POST", "/api/v1/sessions", { name: "nueva", cwd: "/n", parentPid: 950, machine: "" }, { origin: null });
    const res = await f.call("dayan@dev", "POST", "/api/v1/claims/redeem", { code, claudeSessionId: "cy", parentPid: 950, machine: "" }, { origin: null });
    expect(res.status).toBe(200);
    expect(res.data.delivery.kind).toBe("response");
    expect((await f.getRequest(r.id)).status).toBe("closed");
  });
});
