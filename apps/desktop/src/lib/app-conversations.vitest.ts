import type { UserEvent } from "@devi/protocol";
import { afterEach, describe, expect, test, vi } from "vitest";
import { fakeApp } from "./test-app";
import { req } from "./test-fixtures";

// Conecta y abre el canal de eventos para poder empujarlos desde la prueba.
async function connected(conv = {}, files = {}) {
  let push: (e: UserEvent) => void = () => {};
  const subscribe = vi.fn((onEvent: (e: UserEvent) => void, onStatus: (s: string) => void) => {
    push = onEvent;
    onStatus("open");
    return () => {};
  });
  const t = await fakeApp({ subscribe }, {}, conv, files);
  return { ...t, push: (e: UserEvent) => push(e) };
}

describe("DeviApp: conversaciones", () => {
  afterEach(() => vi.useRealTimers());

  test("al conectar pide la lista; abrir una conversación carga su hilo", async () => {
    const { app, conversations } = await connected();
    expect(conversations.conversations).toHaveBeenCalled();
    await app.openConversation("m2");
    expect(app.selected).toBe("m2");
    expect(conversations.conversation).toHaveBeenCalledWith("m2", { limit: 30 });
  });

  test("conversation.updated recarga la lista (una vez) y el hilo abierto", async () => {
    vi.useFakeTimers();
    const { app, conversations, push } = await connected();
    await app.openConversation("m2");
    (conversations.conversations as ReturnType<typeof vi.fn>).mockClear();
    (conversations.conversation as ReturnType<typeof vi.fn>).mockClear();
    push({ type: "conversation.updated", memberId: "m2" });
    push({ type: "conversation.updated", memberId: "m3" });
    await vi.advanceTimersByTimeAsync(300);
    expect(conversations.conversations).toHaveBeenCalledTimes(1);
    expect(conversations.conversation).toHaveBeenCalledTimes(1);
  });

  test("una solicitud que llega entra en el hilo abierto de esa persona", async () => {
    const { app, push } = await connected();
    await app.openConversation("m2");
    push({ type: "request.incoming", request: req({ id: "nueva" }) });
    expect(app.thread.requests.map((r) => r.id)).toContain("nueva");
    expect(app.waiting.m2).toBe(1);
  });

  test("enviar desde la app añade la solicitud al hilo", async () => {
    const sent = req({ id: "q-app", fromMemberId: "m1", toMemberId: "m2", origin: "app", fromSessionName: "" });
    const { app, conversations } = await connected({ sendFromApp: vi.fn(async () => sent) });
    await app.openConversation("m2");
    app.composer.text = "hola";
    await app.sendMessage();
    expect(conversations.sendFromApp).toHaveBeenCalledWith({ to: "m2", message: "hola" }, []);
    expect(app.thread.requests.map((r) => r.id)).toEqual(["q-app"]);
  });

  test("archivos soltados: se adjuntan si hay conversación abierta; si no, se sueltan", async () => {
    let drop: (r: unknown) => void = () => {};
    let hover: (s: { active: boolean }) => void = () => {};
    const files = {
      onFilesDropped: vi.fn(async (cb: (r: unknown) => void) => ((drop = cb), () => {})),
      onDragHover: vi.fn(async (cb: (s: { active: boolean }) => void) => ((hover = cb), () => {})),
    };
    const t = await connected({}, files);
    t.app.listenForDrops();
    await Promise.resolve();
    hover({ active: true });
    expect(t.app.drag.active).toBe(true);
    const picked = { files: [{ token: "t1", name: "a.txt", size: 1, preview: "a" }], rejected: [] };
    drop(picked);
    expect(t.app.drag.active).toBe(false);
    expect(t.files.discardFiles).toHaveBeenCalledWith(["t1"]);
    await t.app.openConversation("m2");
    drop(picked);
    expect(t.app.composer.files.map((f) => f.token)).toEqual(["t1"]);
  });
});
