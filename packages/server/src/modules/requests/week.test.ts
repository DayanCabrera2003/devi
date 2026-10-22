import { afterEach, describe, expect, test } from "bun:test";
import { WEEK_MS } from "@devi/protocol";
import { type Flow, setupFlow } from "./fixture";

let f: Flow;
afterEach(() => f.cleanup());

const MIN = 60_000;
const week = async (login: string) => (await f.call(login, "GET", "/api/v1/me/week", undefined, { origin: null })).data;

// Solicitud de Leo a María, autorizada (el fixture solo trae las de Dayan).
async function leoRequest(message = "¿Me miras el despliegue?") {
  const d = (await f.createDraft("leo@dev", { kind: "request", sessionId: f.leoOps.id, to: "m-maria", message })).data;
  await f.call("leo@dev", "POST", `/api/v1/drafts/${d.id}/authorize`);
  return f.userEvents("m-maria").findLast((e) => e.type === "request.incoming").request as { id: string };
}

describe("GET /me/week", () => {
  test("vacía al principio", async () => {
    f = await setupFlow();
    const now = f.clock.now();
    expect(await week("maria@dev")).toEqual({ from: now - WEEK_MS, to: now, sent: 0, received: 0, answered: 0, avgResponseMs: null, topHelped: [] });
  });

  test("cuenta lo de los últimos 7 días de quien llama y nada más", async () => {
    f = await setupFlow();
    // Fuera de la ventana: una semana y un día antes.
    const old = await f.pendingRequest("antigua");
    await f.call("maria@dev", "POST", `/api/v1/requests/${old.id}/accept`, {});
    f.clock.advance(WEEK_MS + 86_400_000);

    const r1 = await f.pendingRequest("uno");
    f.clock.advance(10 * MIN);
    await f.call("maria@dev", "POST", `/api/v1/requests/${r1.id}/accept`, {});

    const r2 = await leoRequest();
    f.clock.advance(20 * MIN);
    await f.call("maria@dev", "POST", `/api/v1/requests/${r2.id}/forward`, { sessionId: f.mariaApi.id });
    const rd = (await f.responseDraft(r2.id)).data;
    await f.call("maria@dev", "POST", `/api/v1/drafts/${rd.id}/authorize`);

    const r3 = await f.pendingRequest("tres");
    f.clock.advance(30 * MIN);
    await f.call("maria@dev", "POST", `/api/v1/requests/${r3.id}/reject`, { reason: "No me toca" });

    const r4 = await f.pendingRequest("cuatro");
    f.clock.advance(20 * MIN);
    await f.call("maria@dev", "POST", `/api/v1/requests/${r4.id}/accept`, {});

    // Una sin responder: cuenta como recibida, no como respondida.
    await f.pendingRequest("cinco");

    const maria = await week("maria@dev");
    expect(maria).toMatchObject({ sent: 0, received: 5, answered: 4, avgResponseMs: 20 * MIN });
    // Los rechazos no cuentan como ayuda.
    expect(maria.topHelped).toEqual([{ memberId: "m-dayan", count: 2 }, { memberId: "m-leo", count: 1 }]);

    expect(await week("dayan@dev")).toMatchObject({ sent: 4, received: 0, answered: 0, avgResponseMs: null, topHelped: [] });
    expect(await week("leo@dev")).toMatchObject({ sent: 1, received: 0, answered: 0, topHelped: [] });
  });
});
