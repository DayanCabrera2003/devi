import { afterEach, describe, expect, test } from "bun:test";
import { DEFAULT_SETTINGS } from "@devi/protocol";
import { type Flow, setupFlow } from "./fixture";

let f: Flow;
afterEach(() => f.cleanup());

const txt = (name: string, content: string) => new File([content], name);

describe("borradores de solicitud", () => {
  test("crear: queda awaiting, con archivos, y la app de A lo ve", async () => {
    f = await setupFlow();
    const res = await f.requestDraft("Mira este log", [txt("error.log", "boom\n")]);
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({
      kind: "request", status: "awaiting", authorMemberId: "m-dayan", authorSessionId: f.dayanFront.id,
      toMemberId: "m-maria", message: "Mira este log",
      expiresAt: f.clock.now() + DEFAULT_SETTINGS.draftTtlMs,
    });
    expect(res.data.files).toEqual([{ id: expect.any(String), name: "error.log", size: 5, direction: "request" }]);
    expect(f.userEvents("m-dayan")).toContainEqual({ type: "draft.awaiting", draft: res.data });
    expect(f.userEvents("m-maria").some((e) => e.type === "request.incoming")).toBe(false);
  });

  test("validación: sesión ajena, destinatario desconocido, a uno mismo, meta inválido", async () => {
    f = await setupFlow();
    const base = { kind: "request", sessionId: f.dayanFront.id, to: "m-maria", message: "hola" };
    expect((await f.createDraft("dayan@dev", { ...base, sessionId: f.mariaApi.id })).status).toBe(400);
    expect((await f.createDraft("dayan@dev", { ...base, to: "m-nadie" })).status).toBe(404);
    expect((await f.createDraft("dayan@dev", { ...base, to: "m-dayan" })).status).toBe(400);
    expect((await f.createDraft("dayan@dev", { ...base, message: "  " })).status).toBe(400);
    expect((await f.call("dayan@dev", "POST", "/api/v1/drafts", { kind: "request" })).status).toBe(400); // no multipart
    const noMeta = new FormData();
    expect((await f.call("dayan@dev", "POST", "/api/v1/drafts", noMeta)).status).toBe(400);
  });

  test("archivos sin files.send → 403; archivos inválidos → 400 y no se crea nada", async () => {
    f = await setupFlow();
    const res = await f.createDraft("leo@dev", { kind: "request", sessionId: f.leoOps.id, to: "m-maria", message: "x" }, [txt("a.txt", "a")]);
    expect(res.status).toBe(403);
    expect(res.data).toMatchObject({ code: "missing_perm", perm: "files.send" });
    const bad = await f.requestDraft("x", [new File([new Uint8Array([0x61, 0x00])], "bin.dat")]);
    expect(bad.status).toBe(400);
    expect(bad.data.code).toBe("invalid_file");
    expect(f.userEvents("m-dayan").some((e) => e.type === "draft.awaiting")).toBe(false);
  });

  test("autorizar: crea la solicitud pending, avisa a B y a la sesión de A", async () => {
    f = await setupFlow();
    const d = (await f.requestDraft("PR #12", [txt("diff.patch", "+1\n")])).data;
    const res = await f.call("dayan@dev", "POST", `/api/v1/drafts/${d.id}/authorize`);
    expect(res.status).toBe(200);
    expect(res.data.status).toBe("authorized");
    const incoming = f.userEvents("m-maria").find((e) => e.type === "request.incoming");
    expect(incoming.request).toMatchObject({
      fromMemberId: "m-dayan", fromSessionId: f.dayanFront.id, fromSessionName: "frontend", toMemberId: "m-maria",
      message: "PR #12", status: "pending", deadline: f.clock.now() + DEFAULT_SETTINGS.requestTimeoutMs,
    });
    expect(incoming.request.files.map((x: { name: string }) => x.name)).toEqual(["diff.patch"]);
    const [delivery] = f.deliveries(f.dayanFront.id);
    expect(delivery).toMatchObject({ kind: "draft_authorized", meta: { draft_id: d.id, request_id: incoming.request.id } });
    expect(delivery.content).toContain("ya está enviada");
  });

  test("solo el autor autoriza o descarta (403); dos veces → 409; desconocido → 404", async () => {
    f = await setupFlow();
    const d = (await f.requestDraft()).data;
    expect((await f.call("maria@dev", "POST", `/api/v1/drafts/${d.id}/authorize`)).status).toBe(403);
    expect((await f.call("maria@dev", "POST", `/api/v1/drafts/${d.id}/discard`)).status).toBe(403);
    expect((await f.call("dayan@dev", "POST", `/api/v1/drafts/${d.id}/authorize`)).status).toBe(200);
    expect((await f.call("dayan@dev", "POST", `/api/v1/drafts/${d.id}/authorize`)).status).toBe(409);
    expect((await f.call("dayan@dev", "POST", `/api/v1/drafts/${d.id}/discard`)).status).toBe(409);
    expect((await f.call("dayan@dev", "POST", "/api/v1/drafts/nope/authorize")).status).toBe(404);
  });

  test("descartar: draft.discarded a la app y draft_discarded a la sesión; los archivos se liberan", async () => {
    f = await setupFlow();
    const d = (await f.requestDraft("x", [txt("a.txt", "a")])).data;
    const released: string[] = [];
    f.app.ctx.bus.on("draft.discarded", ({ draftId }) => released.push(draftId));
    const res = await f.call("dayan@dev", "POST", `/api/v1/drafts/${d.id}/discard`);
    expect(res.data.status).toBe("discarded");
    expect(f.userEvents("m-dayan")).toContainEqual({ type: "draft.discarded", draftId: d.id });
    expect(f.deliveries(f.dayanFront.id)).toContainEqual({
      kind: "draft_discarded",
      content: "Tu usuario descartó el borrador de solicitud para María. No se envió nada.",
      meta: { draft_id: d.id, reason: "discarded" },
    });
    expect(released).toEqual([d.id]);
  });

  test("caduca a los 15 min", async () => {
    f = await setupFlow();
    const d = (await f.requestDraft()).data;
    f.clock.advance(DEFAULT_SETTINGS.draftTtlMs - 1);
    expect(f.userEvents("m-dayan").some((e) => e.type === "draft.discarded")).toBe(false);
    f.clock.advance(1);
    expect(f.userEvents("m-dayan")).toContainEqual({ type: "draft.discarded", draftId: d.id });
    const last = f.deliveries(f.dayanFront.id).at(-1);
    expect(last.meta).toEqual({ draft_id: d.id, reason: "expired" });
    expect(last.content).toContain("no lo autorizó en 15 min");
    expect((await f.call("dayan@dev", "POST", `/api/v1/drafts/${d.id}/authorize`)).status).toBe(409);
  });

  test("la app recibe al conectar los borradores pendientes", async () => {
    f = await setupFlow();
    const d = (await f.requestDraft()).data;
    const before = f.userEvents("m-dayan").length;
    await f.openStream("dayan@dev", "/api/v1/events/user");
    const replay = f.userEvents("m-dayan").slice(before);
    expect(replay).toContainEqual({ type: "draft.awaiting", draft: d });
  });
});

describe("borradores de respuesta", () => {
  test("solo con la solicitud en forwarded y solo el destinatario", async () => {
    f = await setupFlow();
    const r = await f.pendingRequest();
    expect((await f.responseDraft(r.id)).status).toBe(409);
    await f.call("maria@dev", "POST", `/api/v1/requests/${r.id}/forward`, { sessionId: f.mariaApi.id });
    const notMine = await f.createDraft("leo@dev", { kind: "response", sessionId: f.leoOps.id, requestId: r.id, message: "x" });
    expect(notMine.status).toBe(403);
    const ok = await f.responseDraft(r.id);
    expect(ok.status).toBe(200);
    expect(ok.data).toMatchObject({ kind: "response", requestId: r.id, status: "awaiting" });
  });

  test("uno nuevo sustituye al anterior (reason=replaced)", async () => {
    f = await setupFlow();
    const r = await f.forwardedRequest();
    const first = (await f.responseDraft(r.id, "primera")).data;
    const second = (await f.responseDraft(r.id, "segunda")).data;
    expect(f.deliveries(f.mariaApi.id).find((d) => d.kind === "draft_discarded")?.meta).toEqual({
      draft_id: first.id, reason: "replaced", request_id: r.id,
    });
    expect((await f.call("maria@dev", "POST", `/api/v1/drafts/${first.id}/authorize`)).status).toBe(409);
    expect((await f.call("maria@dev", "POST", `/api/v1/drafts/${second.id}/authorize`)).status).toBe(200);
  });

  test("autorizar: answered, response.incoming a A con los archivos de respuesta", async () => {
    f = await setupFlow();
    const r = await f.forwardedRequest();
    const d = (await f.responseDraft(r.id, "Aprobado", [txt("review.md", "# OK\n")])).data;
    await f.call("maria@dev", "POST", `/api/v1/drafts/${d.id}/authorize`);
    const resp = f.userEvents("m-dayan").find((e) => e.type === "response.incoming");
    expect(resp.request).toMatchObject({ id: r.id, status: "answered", outcome: "answered", outcomeText: "Aprobado" });
    expect(resp.request.responseFiles.map((x: { name: string }) => x.name)).toEqual(["review.md"]);
    expect(f.deliveries(f.mariaApi.id).at(-1)).toMatchObject({ kind: "draft_authorized", meta: { draft_id: d.id, request_id: r.id } });
  });

  test("el plazo se pausa mientras hay borrador de respuesta", async () => {
    f = await setupFlow();
    const r = await f.forwardedRequest();
    await f.responseDraft(r.id);
    f.clock.advance(DEFAULT_SETTINGS.draftTtlMs - 1_000);
    const d2 = (await f.responseDraft(r.id, "otra")).data; // sustituye y sigue en pausa
    f.clock.advance(DEFAULT_SETTINGS.requestTimeoutMs - 60_000);
    expect(f.userEvents("m-dayan").some((e) => e.type === "request.timed_out")).toBe(false);
    expect((await f.call("maria@dev", "POST", `/api/v1/drafts/${d2.id}/authorize`)).status).toBe(409); // caducó
  });

  test("descartar o caducar la respuesta da a la solicitud un plazo nuevo completo", async () => {
    f = await setupFlow();
    const r = await f.forwardedRequest();
    f.clock.advance(DEFAULT_SETTINGS.requestTimeoutMs - 60_000); // casi vencida
    const d = (await f.responseDraft(r.id)).data;
    f.clock.advance(120_000); // el plazo original ya pasó, pero está en pausa
    expect(f.userEvents("m-dayan").some((e) => e.type === "request.timed_out")).toBe(false);
    await f.call("maria@dev", "POST", `/api/v1/drafts/${d.id}/discard`);
    const updated = f.userEvents("m-maria").findLast((e) => e.type === "request.updated");
    expect(updated.request).toMatchObject({ status: "forwarded", deadline: f.clock.now() + DEFAULT_SETTINGS.requestTimeoutMs });
    f.clock.advance(DEFAULT_SETTINGS.requestTimeoutMs - 1);
    expect(f.userEvents("m-dayan").some((e) => e.type === "request.timed_out")).toBe(false);
    f.clock.advance(1);
    expect(f.userEvents("m-dayan").find((e) => e.type === "request.timed_out").request.status).toBe("timed_out");
  });
});
