import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { type AuditEntry, DEFAULT_SETTINGS, SECRETS_FLAG } from "@devi/protocol";
import { auditModule } from "../audit/index";
import { type Flow, setupFlow } from "./fixture";

let f: Flow;
afterEach(() => f.cleanup());

const txt = (name: string, content: string) => new File([content], name);
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

const chatRequest = (message = "¿Me apruebas el PR #12?", files: File[] = []) =>
  f.createDraft("dayan@dev", { kind: "request", sessionId: f.dayanFront.id, to: "m-maria", message, approval: "chat" }, files);
const chatResponse = (requestId: string, message = "Aprobado", files: File[] = []) =>
  f.createDraft("maria@dev", { kind: "response", sessionId: f.mariaApi.id, requestId, message, approval: "chat" }, files);

async function audit(): Promise<AuditEntry[]> {
  const res = await f.call("dayan@dev", "GET", "/api/v1/audit?limit=200");
  return [...res.data.entries].reverse();
}

describe("aprobación en el chat: solicitudes", () => {
  test("se crea y se envía a la vez: B la ve pending, sin paso por la app de A", async () => {
    f = await setupFlow({ extraModules: [auditModule] });
    const res = await chatRequest("PR #12", [txt("diff.patch", "+1\n")]);
    expect(res.status).toBe(200);
    const now = f.clock.now();
    expect(res.data).toMatchObject({
      kind: "request", status: "authorized", approval: "chat", toMemberId: "m-maria",
      sent: { toName: "María", sentAt: now, deadline: now + DEFAULT_SETTINGS.requestTimeoutMs },
    });
    const incoming = f.userEvents("m-maria").find((e) => e.type === "request.incoming");
    expect(incoming.request).toMatchObject({
      id: res.data.sent.requestId, fromMemberId: "m-dayan", fromSessionName: "frontend", status: "pending", message: "PR #12",
      deadline: now + DEFAULT_SETTINGS.requestTimeoutMs,
    });
    expect(incoming.request.files.map((x: { name: string }) => x.name)).toEqual(["diff.patch"]);
    // La app de A ve la solicitud enviada, pero nunca un borrador esperando.
    expect(f.userEvents("m-dayan").some((e) => e.type === "draft.awaiting")).toBe(false);
    expect(f.userEvents("m-dayan")).toContainEqual({ type: "request.updated", request: incoming.request });
    // El resultado de la herramienta ya se lo dice al agente: sin aviso extra a la sesión.
    expect(f.deliveries(f.dayanFront.id)).toEqual([]);
    // Ya no es un borrador que se pueda autorizar o descartar.
    expect((await f.call("dayan@dev", "POST", `/api/v1/drafts/${res.data.id}/authorize`)).status).toBe(409);
    expect((await f.call("dayan@dev", "POST", `/api/v1/drafts/${res.data.id}/discard`)).status).toBe(409);
  });

  test("auditoría: draft.approved_in_chat con quién, a quién, archivos y SHA-256 (sin el texto)", async () => {
    f = await setupFlow({ extraModules: [auditModule] });
    const msg = "clave 1234 del entorno";
    const res = await chatRequest(msg, [txt("log.txt", "hola\n")]);
    const all = await audit();
    expect(all.map((e) => e.action)).toEqual(["draft.approved_in_chat"]);
    const [e] = all;
    expect(e).toMatchObject({ actorMemberId: "m-dayan", actorLogin: "dayan@dev", targetType: "draft", targetId: res.data.id });
    expect(e!.details).toMatchObject({
      kind: "request", from: "m-dayan", fromName: "Dayan", to: "m-maria", toName: "María", requestId: res.data.sent.requestId,
      sessionId: f.dayanFront.id, sessionName: "frontend", messageSha256: sha(msg),
    });
    expect(JSON.parse(e!.details.files!)).toEqual([{ name: "log.txt", size: 5 }]);
    expect(JSON.stringify(e)).not.toContain("1234");
  });

  test("el plazo de la solicitud corre: sin respuesta → timed_out", async () => {
    f = await setupFlow();
    const res = await chatRequest();
    f.clock.advance(DEFAULT_SETTINGS.requestTimeoutMs);
    const ev = f.userEvents("m-dayan").find((e) => e.type === "request.timed_out");
    expect(ev?.request.id).toBe(res.data.sent.requestId);
  });

  test("permisos, archivos inválidos y límites de ritmo siguen aplicando", async () => {
    f = await setupFlow({ rateLimits: { draft: { max: 3, windowMs: 600_000 } } });
    const leo = await f.createDraft("leo@dev", { kind: "request", sessionId: f.leoOps.id, to: "m-maria", message: "x", approval: "chat" }, [txt("a.txt", "a")]);
    expect(leo.status).toBe(403);
    expect(leo.data).toMatchObject({ code: "missing_perm", perm: "files.send" });
    const bad = await chatRequest("x", [new File([new Uint8Array([0x61, 0x00])], "bin.dat")]);
    expect(bad.status).toBe(400);
    expect(bad.data.code).toBe("invalid_file");
    expect((await f.createDraft("dayan@dev", { kind: "request", sessionId: f.dayanFront.id, to: "m-nadie", message: "x", approval: "chat" })).status).toBe(404);
    expect((await f.createDraft("dayan@dev", { kind: "request", sessionId: f.mariaApi.id, to: "m-maria", message: "x", approval: "chat" })).status).toBe(400);
    // El cubo de "draft" (3) ya se gastó en los tres intentos de Dayan de arriba.
    expect((await chatRequest("otro")).status).toBe(429);
    expect(f.userEvents("m-maria").some((e) => e.type === "request.incoming")).toBe(false);
  });

  test("la marca de secretos viaja tal cual en el mensaje", async () => {
    f = await setupFlow();
    const msg = `${SECRETS_FLAG}\n\nla clave es sk-xyz`;
    await chatRequest(msg);
    expect(f.userEvents("m-maria").find((e) => e.type === "request.incoming").request.message).toBe(msg);
  });

  test("chatApproval desactivado: queda en borrador para la app y lo dice", async () => {
    f = await setupFlow({ extraModules: [auditModule] });
    await f.call("dayan@dev", "PATCH", "/api/v1/settings", { chatApproval: false });
    const res = await chatRequest();
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({ status: "awaiting", approval: "app" });
    expect(res.data.sent).toBeUndefined();
    expect(f.userEvents("m-dayan")).toContainEqual({ type: "draft.awaiting", draft: expect.objectContaining({ id: res.data.id }) });
    expect(f.userEvents("m-maria").some((e) => e.type === "request.incoming")).toBe(false);
    expect((await audit()).map((e) => e.action)).toContain("draft.created");
  });

  test("sin approval (o approval app) todo sigue igual que antes", async () => {
    f = await setupFlow();
    const res = await f.requestDraft();
    expect(res.data).toMatchObject({ status: "awaiting", approval: "app" });
    expect(res.data.sent).toBeUndefined();
  });
});

describe("aprobación en el chat: respuestas", () => {
  test("se aplica a la vez: A recibe la respuesta, la solicitud queda answered", async () => {
    f = await setupFlow({ extraModules: [auditModule] });
    const r = await f.forwardedRequest();
    const res = await chatResponse(r.id, "Hecho", [txt("out.txt", "ok\n")]);
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({ kind: "response", status: "authorized", approval: "chat", sent: { requestId: r.id, toName: "Dayan" } });
    expect(res.data.sent.deadline).toBeUndefined();
    const incoming = f.userEvents("m-dayan").find((e) => e.type === "response.incoming");
    expect(incoming.request).toMatchObject({ id: r.id, status: "answered", outcome: "answered", outcomeText: "Hecho" });
    expect(incoming.request.responseFiles.map((x: { name: string }) => x.name)).toEqual(["out.txt"]);
    expect(f.userEvents("m-maria").some((e) => e.type === "draft.awaiting")).toBe(false);
    const actions = (await audit()).map((e) => e.action);
    expect(actions.slice(-2)).toEqual(["draft.approved_in_chat", "request.answered"]);
    // El plazo ya no corre.
    f.clock.advance(DEFAULT_SETTINGS.requestTimeoutMs * 2);
    expect(f.userEvents("m-dayan").some((e) => e.type === "request.timed_out")).toBe(false);
  });

  test("sustituye un borrador de respuesta que esperaba en la app", async () => {
    f = await setupFlow();
    const r = await f.forwardedRequest();
    const old = (await f.responseDraft(r.id)).data;
    const res = await chatResponse(r.id);
    expect(res.data.status).toBe("authorized");
    expect(f.userEvents("m-maria")).toContainEqual({ type: "draft.discarded", draftId: old.id });
    expect((await f.call("maria@dev", "POST", `/api/v1/drafts/${old.id}/authorize`)).status).toBe(409);
  });

  test("solo con la solicitud en forwarded y solo su destinatario", async () => {
    f = await setupFlow();
    const r = await f.pendingRequest();
    expect((await chatResponse(r.id)).status).toBe(409);
    await f.call("maria@dev", "POST", `/api/v1/requests/${r.id}/forward`, { sessionId: f.mariaApi.id });
    const leo = await f.createDraft("leo@dev", { kind: "response", sessionId: f.leoOps.id, requestId: r.id, message: "x", approval: "chat" });
    expect(leo.status).toBe(403);
    expect((await chatResponse(r.id)).status).toBe(200);
    expect((await chatResponse(r.id)).status).toBe(409); // ya está answered
  });

  test("chatApproval desactivado: la respuesta queda en borrador y el plazo se pausa", async () => {
    f = await setupFlow();
    await f.call("dayan@dev", "PATCH", "/api/v1/settings", { chatApproval: false });
    const r = await f.forwardedRequest();
    const res = await chatResponse(r.id);
    expect(res.data).toMatchObject({ status: "awaiting", approval: "app" });
    expect(f.userEvents("m-dayan").some((e) => e.type === "response.incoming")).toBe(false);
  });
});
