import { describe, expect, test, vi } from "vitest";
import { req } from "../test-fixtures";
import { ThreadStore, mergeRequests } from "./thread.svelte";

describe("hilo de una conversación", () => {
  test("se ordena de lo más antiguo a lo más nuevo aunque el servidor lo dé al revés", async () => {
    const t = new ThreadStore();
    const conversation = vi.fn(async () => ({ requests: [req({ id: "b", createdAt: 20 }), req({ id: "a", createdAt: 10 })], nextBefore: 10 }));
    await t.open({ conversation }, "m2");
    expect(t.requests.map((r) => r.id)).toEqual(["a", "b"]);
    expect(t.nextBefore).toBe(10);
    expect(conversation).toHaveBeenCalledWith("m2", { limit: 30 });
  });

  test("cargar anteriores pide con before y mezcla sin repetir", async () => {
    const t = new ThreadStore();
    const conversation = vi
      .fn()
      .mockResolvedValueOnce({ requests: [req({ id: "b", createdAt: 20 })], nextBefore: 20 })
      .mockResolvedValueOnce({ requests: [req({ id: "a", createdAt: 10 }), req({ id: "b", createdAt: 20 })] });
    await t.open({ conversation }, "m2");
    await t.loadMore({ conversation });
    expect(conversation).toHaveBeenLastCalledWith("m2", { before: 20, limit: 30 });
    expect(t.requests.map((r) => r.id)).toEqual(["a", "b"]);
    expect(t.nextBefore).toBeUndefined();
  });

  test("upsert solo acepta solicitudes con esa persona", async () => {
    const t = new ThreadStore();
    await t.open({ conversation: async () => ({ requests: [] }) }, "m2");
    t.upsert(req({ id: "x", fromMemberId: "m9", toMemberId: "m1" }));
    t.upsert(req({ id: "y", status: "forwarded" }));
    expect(t.requests.map((r) => r.id)).toEqual(["y"]);
    t.upsert(req({ id: "y", status: "answered" }));
    expect(t.requests[0]?.status).toBe("answered");
  });

  test("abrir a otra persona descarta una respuesta que llega tarde", async () => {
    const t = new ThreadStore();
    let late: (v: { requests: ReturnType<typeof req>[] }) => void = () => {};
    const a = t.open({ conversation: () => new Promise((ok) => (late = ok)) }, "m2");
    await t.open({ conversation: async () => ({ requests: [req({ id: "j", fromMemberId: "m3" })] }) }, "m3");
    late({ requests: [req({ id: "tarde" })] });
    await a;
    expect(t.memberId).toBe("m3");
    expect(t.requests.map((r) => r.id)).toEqual(["j"]);
  });

  test("mergeRequests: la versión nueva reemplaza a la vieja", () => {
    const out = mergeRequests([req({ id: "a", message: "viejo" })], [req({ id: "a", message: "nuevo" })]);
    expect(out).toHaveLength(1);
    expect(out[0]?.message).toBe("nuevo");
  });
});
