import { describe, expect, test, vi } from "vitest";
import { SESSIONS } from "../test-fixtures";
import { SessionsStore, sortSessions } from "./sessions.svelte";

describe("sesiones", () => {
  test("la preferida primero, luego por nombre", () => {
    expect(sortSessions(SESSIONS).map((s) => s.name)).toEqual(["api", "frontend"]);
    expect(sortSessions(SESSIONS, "s1").map((s) => s.name)).toEqual(["frontend", "api"]);
  });

  test("load guarda la lista o el error", async () => {
    const s = new SessionsStore();
    await s.load({ memberSessions: vi.fn(async () => SESSIONS) }, "m1");
    expect(s.list).toHaveLength(2);
    expect(s.loading).toBe(false);
    await s.load({ memberSessions: vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))) }, "m1");
    expect(s.error).toContain("No se pudo conectar");
  });

  test("dos cargas a la vez: gana la última y loading sigue hasta que acaba", async () => {
    const s = new SessionsStore();
    const resolvers: Array<(v: typeof SESSIONS) => void> = [];
    const api = { memberSessions: vi.fn(() => new Promise<typeof SESSIONS>((ok) => resolvers.push(ok))) };
    const first = s.load(api, "m1");
    const second = s.load(api, "m1");
    resolvers[1]!([SESSIONS[0]!]);
    await second;
    expect(s.list.map((x) => x.id)).toEqual(["s1"]);
    expect(s.loading).toBe(false);
    resolvers[0]!(SESSIONS); // la vieja llega tarde: no pisa la lista
    await first;
    expect(s.list.map((x) => x.id)).toEqual(["s1"]);
    expect(s.loading).toBe(false);
  });

  test("loading sigue activo mientras haya una carga más nueva pendiente", async () => {
    const s = new SessionsStore();
    const resolvers: Array<(v: typeof SESSIONS) => void> = [];
    const api = { memberSessions: vi.fn(() => new Promise<typeof SESSIONS>((ok) => resolvers.push(ok))) };
    const first = s.load(api, "m1");
    void s.load(api, "m1");
    resolvers[0]!(SESSIONS);
    await first;
    expect(s.loading).toBe(true);
    expect(s.list).toHaveLength(0);
  });
});
