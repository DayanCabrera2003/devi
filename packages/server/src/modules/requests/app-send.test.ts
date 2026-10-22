import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_SETTINGS } from "@devi/protocol";
import { type AppFlow, setupAppFlow, txt } from "./app-fixture";

let f: AppFlow;
afterEach(() => f.cleanup());

const onDisk = (dir: string) => (existsSync(join(dir, "files")) ? readdirSync(join(dir, "files")).length : 0);

describe("enviar desde la app", () => {
  test("crea la solicitud pending sin borrador, origin app y sin sesión de origen", async () => {
    f = await setupAppFlow();
    const res = await f.send("dayan@dev", { to: "m-maria", message: "  ¿Me miras el PR #3?  " });
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({
      origin: "app", fromMemberId: "m-dayan", fromSessionId: "", fromSessionName: "", toMemberId: "m-maria",
      message: "¿Me miras el PR #3?", status: "pending", files: [], responseFiles: [],
      createdAt: f.clock.now(), sentAt: f.clock.now(), deadline: f.clock.now() + DEFAULT_SETTINGS.requestTimeoutMs,
    });
    expect(f.userEvents("m-maria")).toContainEqual({ type: "request.incoming", request: res.data });
    expect(f.userEvents("m-dayan")).toContainEqual({ type: "request.updated", request: res.data });
    expect(f.userEvents("m-dayan").some((e) => e.type === "draft.awaiting")).toBe(false);
    expect(f.userEvents("m-dayan")).toContainEqual({ type: "conversation.updated", memberId: "m-maria" });
    expect(f.userEvents("m-maria")).toContainEqual({ type: "conversation.updated", memberId: "m-dayan" });
    const entry = (await f.audit()).find((e) => e.action === "request.sent_from_app");
    expect(entry).toMatchObject({ actorMemberId: "m-dayan", targetType: "request", targetId: res.data.id });
    expect(entry.details).toMatchObject({ to: "m-maria", toName: "María", files: "[]" });
    expect(entry.details.messageSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(entry)).not.toContain("PR #3");
  });

  test("con archivos: se adjuntan a la solicitud y el destinatario puede descargarlos", async () => {
    f = await setupAppFlow();
    const res = await f.send("dayan@dev", { to: "m-maria", message: "mira" }, [txt("../error.log", "boom\n"), txt("error.log", "x")]);
    expect(res.status).toBe(200);
    expect(res.data.files.map((x: { name: string }) => x.name)).toEqual(["error.log", "error (2).log"]);
    const dl = await f.call("maria@dev", "GET", `/api/v1/files/${res.data.files[0].id}`);
    expect(dl.status).toBe(200);
    expect(dl.data).toBe("boom\n");
    expect((await f.call("leo@dev", "GET", `/api/v1/files/${res.data.files[0].id}`)).status).toBe(403);
  });

  test("permisos: human_only sin Origin; missing_perm sin requests.send; files.send si hay archivos", async () => {
    f = await setupAppFlow();
    const noOrigin = await f.send("dayan@dev", { to: "m-maria", message: "hola" }, [], { origin: null });
    expect(noOrigin.status).toBe(403);
    expect(noOrigin.data.code).toBe("human_only");
    const ana = await f.send("ana@dev", { to: "m-maria", message: "hola" });
    expect(ana.status).toBe(403);
    expect(ana.data).toMatchObject({ code: "missing_perm", perm: "requests.send" });
    const leo = await f.send("leo@dev", { to: "m-maria", message: "hola" }, [txt("a.txt", "a")]);
    expect(leo.status).toBe(403);
    expect(leo.data).toMatchObject({ code: "missing_perm", perm: "files.send" });
    expect((await f.send("leo@dev", { to: "m-maria", message: "hola" })).status).toBe(200);
    expect(f.userEvents("m-maria").filter((e) => e.type === "request.incoming")).toHaveLength(1);
  });

  test("validación: destinatario, mensaje, multipart y archivos; si falla no se crea ni se escribe nada", async () => {
    f = await setupAppFlow();
    const before = onDisk(f.dataDir);
    expect((await f.send("dayan@dev", { to: "m-nadie", message: "hola" })).status).toBe(404);
    expect((await f.send("dayan@dev", { to: "m-pablo", message: "hola" })).status).toBe(404);
    expect((await f.send("dayan@dev", { to: "m-dayan", message: "hola" })).status).toBe(400);
    expect((await f.send("dayan@dev", { to: "m-maria", message: "   " })).status).toBe(400);
    expect((await f.send("dayan@dev", "{no es json")).status).toBe(400);
    expect((await f.call("dayan@dev", "POST", "/api/v1/requests", { to: "m-maria", message: "hola" })).status).toBe(400);
    const nul = await f.send("dayan@dev", { to: "m-maria", message: "hola" }, [new File([new Uint8Array([0x61, 0])], "bin.dat")]);
    expect(nul.status).toBe(400);
    expect(nul.data.code).toBe("invalid_file");
    const latin1 = await f.send("dayan@dev", { to: "m-maria", message: "hola" }, [new File([new Uint8Array([0xe9])], "a.txt")]);
    expect(latin1.data.code).toBe("invalid_file");
    const big = await f.send("dayan@dev", { to: "m-maria", message: "hola" }, [txt("big.txt", "x".repeat(1_048_577))]);
    expect(big.data.code).toBe("invalid_file");
    const six = Array.from({ length: 6 }, (_, i) => txt(`${i}.txt`, "x"));
    expect((await f.send("dayan@dev", { to: "m-maria", message: "hola" }, six)).status).toBe(400);
    expect(f.userEvents("m-maria").some((e) => e.type === "request.incoming")).toBe(false);
    expect(onDisk(f.dataDir)).toBe(before);
  });

  test("límites de ritmo: cuenta como un borrador, y con archivos también como borrador con archivos", async () => {
    f = await setupAppFlow({ rateLimits: { draft: { max: 2, windowMs: 60_000 }, draftFiles: { max: 1, windowMs: 60_000 } } });
    expect((await f.send("dayan@dev", { to: "m-maria", message: "uno" }, [txt("a.txt", "a")])).status).toBe(200);
    const files = await f.send("dayan@dev", { to: "m-maria", message: "dos" }, [txt("a.txt", "a")]);
    expect(files.status).toBe(429);
    expect(files.data.code).toBe("rate_limit");
    expect((await f.send("dayan@dev", { to: "m-maria", message: "tres" })).status).toBe(429);
  });
});

describe("solicitudes enviadas desde la app: el resto del ciclo", () => {
  test("B la reenvía a su sesión: el agente ve que llegó desde la app, sin sesión de origen", async () => {
    f = await setupAppFlow();
    const maria = await f.session("maria@dev", "backend-api", 200);
    const r = (await f.send("dayan@dev", { to: "m-maria", message: "¿Revisas el log?" })).data;
    const res = await f.call("maria@dev", "POST", `/api/v1/requests/${r.id}/forward`, { sessionId: maria.id });
    expect(res.status).toBe(200);
    const [delivery] = f.deliveries(maria.id).filter((d) => d.kind !== "request_notice"); // sin el aviso de llegada
    expect(delivery.kind).toBe("request");
    expect(delivery.content).toContain("desde la app de Devi");
    expect(delivery.content).not.toContain('sesión ""');
    expect(delivery.meta).toMatchObject({ request_id: r.id, from: "m-dayan", from_session: "" });
  });

  test("respuesta de B: A recibe response.incoming y puede aceptarla o mandarla a una de sus sesiones", async () => {
    f = await setupAppFlow();
    const dayan = await f.session("dayan@dev", "frontend", 100);
    const maria = await f.session("maria@dev", "backend-api", 200);
    const r1 = (await f.send("dayan@dev", { to: "m-maria", message: "uno" })).data;
    const r2 = (await f.send("dayan@dev", { to: "m-maria", message: "dos" })).data;
    await f.call("maria@dev", "POST", `/api/v1/requests/${r1.id}/accept`, { note: "lo hago yo" });
    // r2: respuesta escrita por el agente de María (borrador) y autorizada por ella.
    await f.call("maria@dev", "POST", `/api/v1/requests/${r2.id}/forward`, { sessionId: maria.id });
    const form = new FormData();
    form.set("meta", JSON.stringify({ kind: "response", sessionId: maria.id, requestId: r2.id, message: "hecho" }));
    const d = (await f.call("maria@dev", "POST", "/api/v1/drafts", form)).data;
    expect((await f.call("maria@dev", "POST", `/api/v1/drafts/${d.id}/authorize`)).status).toBe(200);
    const incoming = f.userEvents("m-dayan").filter((e) => e.type === "response.incoming").map((e) => e.request);
    expect(incoming.map((x) => [x.id, x.outcome, x.outcomeText, x.origin])).toEqual([
      [r1.id, "accepted", "lo hago yo", "app"],
      [r2.id, "answered", "hecho", "app"],
    ]);
    expect((await f.call("dayan@dev", "POST", `/api/v1/requests/${r1.id}/response/accept`)).data.status).toBe("closed");
    const fwd = await f.call("dayan@dev", "POST", `/api/v1/requests/${r2.id}/response/forward`, { sessionId: dayan.id });
    expect(fwd.data.status).toBe("closed");
    expect(f.deliveries(dayan.id).at(-1)).toMatchObject({ kind: "response", meta: { request_id: r2.id, outcome: "answered" } });
  });

  test("sin respuesta a tiempo: timed_out para A, que puede reenviarla", async () => {
    f = await setupAppFlow();
    const r = (await f.send("dayan@dev", { to: "m-maria", message: "¿sigues?" })).data;
    f.clock.advance(DEFAULT_SETTINGS.requestTimeoutMs + 1);
    expect(f.userEvents("m-dayan").find((e) => e.type === "request.timed_out")?.request).toMatchObject({ id: r.id, status: "timed_out" });
    const again = await f.call("dayan@dev", "POST", `/api/v1/requests/${r.id}/resend`);
    expect(again.data).toMatchObject({ status: "pending", origin: "app" });
  });
});
