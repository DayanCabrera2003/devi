import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { type ChatFlow, setupChat, txt } from "./fixture";

let f: ChatFlow;
afterEach(() => f.cleanup());

const onDisk = (dir: string) => (existsSync(join(dir, "files")) ? readdirSync(join(dir, "files")).length : 0);

describe("enviar un mensaje de chat desde la app", () => {
  test("llega a las dos partes al momento, sin plazo ni estados, y se audita sin el texto", async () => {
    f = await setupChat();
    const res = await f.send("dayan@dev", { to: "m-maria", text: "  ¿comemos a la 1?  " });
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({
      fromMemberId: "m-dayan", toMemberId: "m-maria", text: "¿comemos a la 1?", files: [], origin: "app",
      fromSessionName: "", createdAt: f.clock.now(),
    });
    expect(f.userEvents("m-maria")).toContainEqual({ type: "chat.message", message: res.data });
    expect(f.userEvents("m-dayan")).toContainEqual({ type: "chat.message", message: res.data });
    expect(f.userEvents("m-maria")).toContainEqual({ type: "conversation.updated", memberId: "m-dayan" });
    expect(f.userEvents("m-dayan")).toContainEqual({ type: "conversation.updated", memberId: "m-maria" });
    expect(f.userEvents("m-maria").some((e) => e.type === "request.incoming")).toBe(false);
    const entry = (await f.audit()).find((e) => e.action === "chat.sent");
    expect(entry).toMatchObject({ actorMemberId: "m-dayan", targetType: "chat", targetId: res.data.id });
    expect(entry.details).toMatchObject({ to: "m-maria", toName: "María", files: "[]" });
    expect(entry.details.textSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(entry)).not.toContain("comemos");
  });

  test("con archivos: la otra parte los descarga; nadie más", async () => {
    f = await setupChat();
    const res = await f.send("dayan@dev", { to: "m-maria", text: "mira" }, [txt("notas.md", "uno\n")]);
    expect(res.status).toBe(200);
    expect(res.data.files.map((x: { name: string }) => x.name)).toEqual(["notas.md"]);
    const dl = await f.call("maria@dev", "GET", `/api/v1/files/${res.data.files[0].id}`);
    expect(dl.status).toBe(200);
    expect(dl.data).toBe("uno\n");
    expect((await f.call("leo@dev", "GET", `/api/v1/files/${res.data.files[0].id}`)).status).toBe(403);
  });

  test("permisos: human_only sin Origin; requests.send; files.send si hay archivos", async () => {
    f = await setupChat();
    const noOrigin = await f.send("dayan@dev", { to: "m-maria", text: "hola" }, [], { origin: null });
    expect(noOrigin.data.code).toBe("human_only");
    expect((await f.send("ana@dev", { to: "m-maria", text: "hola" })).data).toMatchObject({ code: "missing_perm", perm: "requests.send" });
    expect((await f.send("leo@dev", { to: "m-maria", text: "hola" }, [txt("a.txt", "a")])).data).toMatchObject({
      code: "missing_perm", perm: "files.send",
    });
    expect((await f.send("leo@dev", { to: "m-maria", text: "hola" })).status).toBe(200);
  });

  test("validación: destinatario, uno mismo, texto y multipart; si falla no se escribe nada", async () => {
    f = await setupChat();
    expect((await f.send("dayan@dev", { to: "m-nadie", text: "hola" })).status).toBe(404);
    expect((await f.send("dayan@dev", { to: "m-pablo", text: "hola" })).status).toBe(404);
    expect((await f.send("dayan@dev", { to: "m-dayan", text: "hola" })).status).toBe(400);
    expect((await f.send("dayan@dev", { to: "m-maria", text: "   " })).status).toBe(400);
    expect((await f.send("dayan@dev", "{no json")).status).toBe(400);
    expect((await f.send("dayan@dev", { to: "m-maria", text: "hola" }, [new File([new Uint8Array([0, 1, 2])], "x.bin")])).status).toBe(400);
    expect((await f.send("dayan@dev", { to: "m-nadie", text: "hola" }, [txt("a.txt", "a")])).status).toBe(404);
    expect(onDisk(f.dataDir)).toBe(0);
    expect((await f.page("dayan@dev", "m-maria")).data.messages).toEqual([]);
  });
});

describe("leer el chat", () => {
  test("solo los mensajes entre quien llama y esa persona, de lo más nuevo a lo más viejo, paginados", async () => {
    f = await setupChat();
    const a = (await f.send("dayan@dev", { to: "m-maria", text: "uno" })).data;
    f.clock.advance(1000);
    const b = (await f.send("maria@dev", { to: "m-dayan", text: "dos" })).data;
    f.clock.advance(1000);
    await f.send("leo@dev", { to: "m-maria", text: "de Leo" });
    const first = await f.page("dayan@dev", "m-maria", "?limit=1");
    expect(first.data.messages.map((m: { id: string }) => m.id)).toEqual([b.id]);
    expect(first.data.nextBefore).toBe(b.createdAt);
    const second = await f.page("dayan@dev", "m-maria", `?limit=1&before=${first.data.nextBefore}`);
    expect(second.data.messages.map((m: { id: string }) => m.id)).toEqual([a.id]);
    expect((await f.page("leo@dev", "m-dayan")).data.messages).toEqual([]);
    expect((await f.page("dayan@dev", "m-dayan")).status).toBe(400);
  });

  test("la conversación muestra el último mensaje del chat en la barra lateral", async () => {
    f = await setupChat();
    f.clock.advance(1000);
    await f.send("maria@dev", { to: "m-dayan", text: "¿lo viste?" });
    const row = (await f.call("dayan@dev", "GET", "/api/v1/conversations")).data.items.find((r: { memberId: string }) => r.memberId === "m-maria");
    expect(row).toMatchObject({ lastAt: f.clock.now(), lastPreview: "¿lo viste?", lastFromMe: false, waitingOnMe: 0 });
  });
});

describe("enviar un mensaje a mi sesión", () => {
  test("el del compañero o el mío, con sus archivos, a una sesión viva mía: encuadrado como datos", async () => {
    f = await setupChat();
    const s = await f.session("maria@dev", "api", 200);
    const m = (await f.send("dayan@dev", { to: "m-maria", text: "revisa el log" }, [txt("error.log", "boom")])).data;
    const res = await f.toSession("maria@dev", m.id, s.id);
    expect(res.status).toBe(200);
    const d = f.deliveries(s.id).at(-1);
    expect(d.kind).toBe("chat");
    expect(d.meta).toMatchObject({ message_id: m.id, from: "m-dayan", from_name: "Dayan" });
    expect(JSON.parse(d.meta.files)).toEqual([{ id: m.files[0].id, name: "error.log" }]);
    expect(d.content).toContain("DEVI-UNTRUSTED");
    expect(d.content).toContain("revisa el log");
    expect(d.content).toContain("reply_in_chat");
    const again = await f.toSession("maria@dev", m.id, s.id);
    expect(again.status).toBe(200);
    const own = await f.session("dayan@dev", "front", 100);
    expect((await f.toSession("dayan@dev", m.id, own.id)).status).toBe(200);
    expect(f.deliveries(own.id).at(-1).content).toContain("Mensaje tuyo");
    expect((await f.audit()).filter((e) => e.action === "chat.to_session")).toHaveLength(3);
  });

  test("solo las partes, solo a una sesión propia y viva, que entienda el chat, y desde la app", async () => {
    f = await setupChat();
    const maria = await f.session("maria@dev", "api", 200);
    const old = await f.session("maria@dev", "vieja", 201, []);
    const leo = await f.session("leo@dev", "ops", 300);
    const m = (await f.send("dayan@dev", { to: "m-maria", text: "hola" })).data;
    expect((await f.toSession("leo@dev", m.id, leo.id)).status).toBe(404);
    expect((await f.toSession("maria@dev", m.id, leo.id)).data.code).toBe("session_gone");
    expect((await f.toSession("maria@dev", m.id, old.id)).data.code).toBe("session_outdated");
    expect((await f.toSession("maria@dev", m.id, maria.id, { origin: null })).data.code).toBe("human_only");
    expect((await f.toSession("maria@dev", "c-nada", maria.id)).status).toBe(404);
  });
});

describe("Claude escribe en el chat", () => {
  test("con la aprobación del aviso de Claude Code sale como mensaje de su sesión", async () => {
    f = await setupChat();
    const s = await f.session("maria@dev", "api", 200);
    const res = await f.fromSession("maria@dev", { sessionId: s.id, to: "m-dayan", text: "Ya está el PR", approval: "chat" });
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({ fromMemberId: "m-maria", toMemberId: "m-dayan", origin: "session", fromSessionName: "api" });
    expect(f.userEvents("m-dayan")).toContainEqual({ type: "chat.message", message: res.data });
    expect((await f.audit()).find((e) => e.action === "chat.sent_from_session")).toMatchObject({ actorMemberId: "m-maria" });
  });

  test("sin aprobación en el chat (o desactivada en el equipo) no sale; tampoco desde una sesión ajena", async () => {
    f = await setupChat();
    const s = await f.session("maria@dev", "api", 200);
    const leo = await f.session("leo@dev", "ops", 300);
    const app = await f.fromSession("maria@dev", { sessionId: s.id, to: "m-dayan", text: "hola", approval: "app" });
    expect(app.data.code).toBe("chat_approval_unavailable");
    expect((await f.fromSession("maria@dev", { sessionId: leo.id, to: "m-dayan", text: "hola", approval: "chat" })).data.code).toBe("session_gone");
    await f.call("dayan@dev", "PATCH", "/api/v1/settings", { chatApproval: false });
    const off = await f.fromSession("maria@dev", { sessionId: s.id, to: "m-dayan", text: "hola", approval: "chat" });
    expect(off.data.code).toBe("chat_approval_unavailable");
    expect((await f.page("dayan@dev", "m-maria")).data.messages).toEqual([]);
  });
});

describe("auditoría para apps anteriores", () => {
  test("sin la feature audit_chat, las acciones del chat salen como su equivalente antiguo", async () => {
    f = await setupChat();
    await f.send("dayan@dev", { to: "m-maria", text: "hola" });
    const entries = await f.audit("audit_in_chat");
    const e = entries.find((x) => x.details.via === "chat" && x.action === "request.sent_from_app");
    expect(e).toMatchObject({ targetType: "request" });
    expect(entries.some((x) => String(x.action).startsWith("chat."))).toBe(false);
  });
});
