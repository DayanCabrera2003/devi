import { describe, expect, test } from "bun:test";
import { FakeClock } from "./clock";
import { HttpError } from "./http";
import { DEFAULT_RATE_LIMITS, RateLimiter } from "./ratelimit";

const catch429 = (fn: () => void): HttpError => {
  try {
    fn();
  } catch (e) {
    return e as HttpError;
  }
  throw new Error("no lanzó");
};

describe("RateLimiter (cubeta de fichas)", () => {
  test("límites por defecto", () => {
    expect(DEFAULT_RATE_LIMITS).toEqual({
      draft: { max: 20, windowMs: 600_000 },
      draftFiles: { max: 5, windowMs: 600_000 },
      mutation: { max: 120, windowMs: 60_000 },
      claimRedeem: { max: 10, windowMs: 600_000 },
    });
  });

  test("deja pasar hasta max, luego 429 rate_limit con Retry-After; se rellena con el tiempo", () => {
    const clock = new FakeClock();
    const rl = new RateLimiter(clock.now, { draftFiles: { max: 2, windowMs: 60_000 } });
    rl.take("draftFiles", "m1");
    rl.take("draftFiles", "m1");
    const e = catch429(() => rl.take("draftFiles", "m1"));
    expect(e.status).toBe(429);
    expect(e.extra.code).toBe("rate_limit");
    expect(e.message).toContain("30 s");
    expect(e.headers).toEqual({ "Retry-After": "30" });
    rl.take("draftFiles", "m2"); // otra persona, otra cubeta
    clock.advance(30_000);
    rl.take("draftFiles", "m1");
    expect(() => rl.take("draftFiles", "m1")).toThrow();
  });

  test("Retry-After nunca es 0", () => {
    const clock = new FakeClock();
    const rl = new RateLimiter(clock.now, { mutation: { max: 1, windowMs: 1000 } });
    rl.take("mutation", "m");
    clock.advance(999);
    expect(catch429(() => rl.take("mutation", "m")).headers).toEqual({ "Retry-After": "1" });
  });

  test("claimRedeem: 10 canjes por persona cada 10 min", () => {
    const rl = new RateLimiter(() => 0);
    for (let i = 0; i < 10; i++) rl.take("claimRedeem", "m1");
    expect(() => rl.take("claimRedeem", "m1")).toThrow();
    expect(() => rl.take("claimRedeem", "m2")).not.toThrow();
  });
});
