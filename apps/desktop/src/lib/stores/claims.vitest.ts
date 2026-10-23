import { describe, expect, test } from "vitest";
import { ClaimsStore } from "./claims.svelte";

const claim = (status: "open" | "used" | "cancelled" | "expired", id = "r1") =>
  ({ code: "K7Q4MX", target: { type: "request" as const, id }, expiresAt: Date.now() + 600_000, status });

describe("ClaimsStore", () => {
  test("open entra; used, cancelled y expired salen", () => {
    const s = new ClaimsStore();
    s.apply(claim("open"));
    expect(s.openFor({ type: "request", id: "r1" })?.code).toBe("K7Q4MX");
    s.apply(claim("used"));
    expect(s.openFor({ type: "request", id: "r1" })).toBeNull();
  });

  test("set reemplaza la lista (carga inicial)", () => {
    const s = new ClaimsStore();
    s.set([claim("open", "a"), claim("open", "b")]);
    expect(s.openFor({ type: "request", id: "b" })).not.toBeNull();
  });

  test("un código caducado no cuenta aunque no haya llegado el evento", () => {
    const s = new ClaimsStore();
    s.apply({ ...claim("open"), expiresAt: Date.now() - 1 });
    expect(s.openFor({ type: "request", id: "r1" })).toBeNull();
  });
});
