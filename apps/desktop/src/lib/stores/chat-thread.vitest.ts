import { describe, expect, test, vi } from "vitest";
import { chatMsg } from "../test-fixtures";
import { CHAT_PAGE, ChatThreadStore } from "./chat-thread.svelte";

describe("mensajes del chat de una conversación", () => {
  test("se ordenan de lo más antiguo a lo más nuevo y recuerdan el cursor", async () => {
    const t = new ChatThreadStore();
    const chat = vi.fn(async () => ({ messages: [chatMsg({ id: "b", createdAt: 20 }), chatMsg({ id: "a", createdAt: 10 })], nextBefore: 10 }));
    await t.open({ chat }, "m2");
    expect(t.messages.map((m) => m.id)).toEqual(["a", "b"]);
    expect(t.nextBefore).toBe(10);
    expect(chat).toHaveBeenCalledWith("m2", { limit: CHAT_PAGE });
  });

  test("cargar anteriores pide con before y mezcla sin repetir", async () => {
    const t = new ChatThreadStore();
    const chat = vi
      .fn()
      .mockResolvedValueOnce({ messages: [chatMsg({ id: "b", createdAt: 20 })], nextBefore: 20 })
      .mockResolvedValueOnce({ messages: [chatMsg({ id: "a", createdAt: 10 }), chatMsg({ id: "b", createdAt: 20 })] });
    await t.open({ chat }, "m2");
    await t.loadMore({ chat });
    expect(chat).toHaveBeenLastCalledWith("m2", { before: 20, limit: CHAT_PAGE });
    expect(t.messages.map((m) => m.id)).toEqual(["a", "b"]);
    expect(t.nextBefore).toBeUndefined();
  });

  test("upsert solo acepta mensajes con esa persona y no los repite", async () => {
    const t = new ChatThreadStore();
    await t.open({ chat: async () => ({ messages: [] }) }, "m2");
    t.upsert(chatMsg({ id: "x" }));
    t.upsert(chatMsg({ id: "x" }));
    t.upsert(chatMsg({ id: "y", fromMemberId: "m3", toMemberId: "m1" }));
    expect(t.messages.map((m) => m.id)).toEqual(["x"]);
  });

  test("un servidor sin chat (404) deja la conversación sin mensajes y sin error", async () => {
    const t = new ChatThreadStore();
    await t.open({ chat: async () => Promise.reject(Object.assign(new Error("no"), { status: 404, body: { error: "no" } })) }, "m2");
    expect(t.messages).toEqual([]);
    expect(t.error).toBeNull();
  });

  test("cerrar vacía todo", async () => {
    const t = new ChatThreadStore();
    await t.open({ chat: async () => ({ messages: [chatMsg()], nextBefore: 1 }) }, "m2");
    t.close();
    expect(t.messages).toEqual([]);
    expect(t.memberId).toBeNull();
    expect(t.nextBefore).toBeUndefined();
  });
});
