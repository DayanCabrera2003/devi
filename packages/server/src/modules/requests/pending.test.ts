import { afterEach, describe, expect, test } from "bun:test";
import { DEFAULT_SETTINGS } from "@devi/protocol";
import { type Flow, setupFlow } from "./fixture";

let f: Flow;
afterEach(() => f.cleanup());

// Lecturas del agente: sin Origin (como el MCP).
const agent = { origin: null };
const pending = async (login: string) => (await f.call(login, "GET", "/api/v1/pending", undefined, agent)).data;
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

describe("GET /pending", () => {
  test("vacío al principio", async () => {
    f = await setupFlow();
    expect(await pending("dayan@dev")).toEqual({ incoming: [], responses: [], timedOut: [], drafts: [], outgoing: [] });
  });

  test("cada lado ve lo suyo a lo largo del ciclo de una solicitud", async () => {
    f = await setupFlow();
    // Borrador de Dayan esperando autorización: solo lo ve Dayan, en drafts.
    const d = (await f.requestDraft("¿Me apruebas el PR #12?")).data;
    expect(ids((await pending("dayan@dev")).drafts)).toEqual([d.id]);
    expect((await pending("maria@dev")).incoming).toEqual([]);

    // Autorizado: abierta para Dayan (outgoing), esperando a María (incoming).
    await f.call("dayan@dev", "POST", `/api/v1/drafts/${d.id}/authorize`);
    const r = f.userEvents("m-maria").findLast((e) => e.type === "request.incoming").request;
    let dayan = await pending("dayan@dev");
    expect(dayan.drafts).toEqual([]);
    expect(ids(dayan.outgoing)).toEqual([r.id]);
    expect((await pending("maria@dev")).incoming.map((x: { id: string; status: string }) => [x.id, x.status])).toEqual([[r.id, "pending"]]);

    // Reenviada a una sesión de María: sigue esperando a María (forwarded) y abierta para Dayan.
    await f.call("maria@dev", "POST", `/api/v1/requests/${r.id}/forward`, { sessionId: f.mariaApi.id });
    expect((await pending("maria@dev")).incoming[0].status).toBe("forwarded");
    expect((await pending("dayan@dev")).outgoing[0].status).toBe("forwarded");

    // Respondida: María autoriza su borrador de respuesta (que mientras tanto es suyo, en drafts).
    const rd = (await f.responseDraft(r.id)).data;
    expect(ids((await pending("maria@dev")).drafts)).toEqual([rd.id]);
    await f.call("maria@dev", "POST", `/api/v1/drafts/${rd.id}/authorize`);
    expect(await pending("maria@dev")).toEqual({ incoming: [], responses: [], timedOut: [], drafts: [], outgoing: [] });
    dayan = await pending("dayan@dev");
    expect(dayan.outgoing).toEqual([]);
    expect(dayan.responses.map((x: { id: string; status: string }) => [x.id, x.status])).toEqual([[r.id, "answered"]]);

    // Aceptada la respuesta, ya no espera nada.
    await f.call("dayan@dev", "POST", `/api/v1/requests/${r.id}/response/accept`);
    expect((await pending("dayan@dev")).responses).toEqual([]);
  });

  test("las caducadas van en timedOut del remitente", async () => {
    f = await setupFlow();
    const r = await f.pendingRequest();
    f.clock.advance(DEFAULT_SETTINGS.requestTimeoutMs + 1);
    const dayan = await pending("dayan@dev");
    expect(ids(dayan.timedOut)).toEqual([r.id]);
    expect(dayan.outgoing).toEqual([]);
    expect((await pending("maria@dev")).incoming).toEqual([]);
  });

  test("nunca incluye lo de otras personas", async () => {
    f = await setupFlow();
    await f.pendingRequest();
    expect(await pending("leo@dev")).toEqual({ incoming: [], responses: [], timedOut: [], drafts: [], outgoing: [] });
  });
});

describe("GET /requests/:id", () => {
  test("las dos partes la leen (sin Origin); un tercero o un id que no existe: 404", async () => {
    f = await setupFlow();
    const r = await f.pendingRequest("¿Me apruebas el PR #12?");
    for (const login of ["dayan@dev", "maria@dev"]) {
      const res = await f.call(login, "GET", `/api/v1/requests/${r.id}`, undefined, agent);
      expect(res.status).toBe(200);
      expect(res.data).toMatchObject({ id: r.id, status: "pending", message: "¿Me apruebas el PR #12?", fromMemberId: "m-dayan", toMemberId: "m-maria" });
    }
    expect((await f.call("leo@dev", "GET", `/api/v1/requests/${r.id}`, undefined, agent)).status).toBe(404);
    expect((await f.call("dayan@dev", "GET", "/api/v1/requests/nada", undefined, agent)).status).toBe(404);
  });
});
