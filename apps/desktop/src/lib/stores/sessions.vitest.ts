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
});
