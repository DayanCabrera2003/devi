import { describe, expect, test, vi } from "vitest";
import { ConversationsStore, buildRows, filterRows } from "./conversations.svelte";

const members = [
  { id: "m1", login: "yo@x", name: "Yo", description: "", roleIds: [], disabled: false, connected: true },
  { id: "m2", login: "maria@x", name: "María", description: "", roleIds: [], disabled: false, connected: true },
  { id: "m3", login: "jorge@x", name: "Jorge", description: "", roleIds: [], disabled: false, connected: false },
  { id: "m4", login: "ana@x", name: "Ana", description: "", roleIds: [], disabled: true, connected: false },
];

describe("lista de conversaciones", () => {
  test("una fila por compañero activo, lo más reciente arriba y sin mí", () => {
    const rows = buildRows(
      [{ memberId: "m3", lastAt: 50, lastPreview: "hola", lastFromMe: true, waitingOnMe: 0 }],
      members,
      "m1",
    );
    expect(rows.map((r) => r.memberId)).toEqual(["m3", "m2"]);
    expect(rows[0]).toMatchObject({ lastPreview: "hola", lastFromMe: true, connected: false });
  });

  test("lo que espera es el máximo entre el servidor y la bandeja local", () => {
    const rows = buildRows([{ memberId: "m2", lastAt: 1, lastPreview: null, lastFromMe: false, waitingOnMe: 1 }], members, "m1", { m2: 3 });
    expect(rows.find((r) => r.memberId === "m2")?.waiting).toBe(3);
  });

  test("Te esperan filtra a quien espera algo; la búsqueda ignora acentos", () => {
    const rows = buildRows([], members, "m1", { m3: 1 });
    expect(filterRows(rows, "waiting", "").map((r) => r.memberId)).toEqual(["m3"]);
    expect(filterRows(rows, "all", "maria").map((r) => r.memberId)).toEqual(["m2"]);
  });

  test("solo escribe la última carga", async () => {
    const store = new ConversationsStore();
    let first: (v: { items: never[] }) => void = () => {};
    const slow = { conversations: vi.fn(() => new Promise<{ items: never[] }>((ok) => (first = ok))) };
    const fast = { conversations: vi.fn(async () => ({ items: [{ memberId: "m2", lastAt: 1, lastPreview: "x", lastFromMe: false, waitingOnMe: 0 }] })) };
    const a = store.load(slow);
    await store.load(fast);
    first({ items: [] });
    await a;
    expect(store.items).toHaveLength(1);
    expect(store.loaded).toBe(true);
  });

  test("un error se guarda y no borra lo que había", async () => {
    const store = new ConversationsStore();
    await store.load({ conversations: async () => ({ items: [{ memberId: "m2", lastAt: 1, lastPreview: "x", lastFromMe: false, waitingOnMe: 0 }] }) });
    await store.load({ conversations: async () => Promise.reject(new Error("caído")) });
    expect(store.error).toBe("caído");
    expect(store.items).toHaveLength(1);
  });
});
