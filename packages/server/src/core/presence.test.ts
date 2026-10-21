import { describe, expect, test } from "bun:test";
import { PRESENCE } from "@devi/protocol";
import { Bus } from "./bus";
import { FakeClock } from "./clock";
import { Presence } from "./presence";
import { SseHub } from "./sse";

function setup() {
  const clock = new FakeClock(0);
  const bus = new Bus();
  const changes: { key: string; alive: boolean }[] = [];
  bus.on("presence.changed", (c) => changes.push(c));
  const presence = new Presence(new SseHub(), bus, clock.now);
  return { clock, presence, changes };
}

describe("Presence", () => {
  test("abrir el SSE la marca viva; cerrarlo, no viva", () => {
    const { presence, changes } = setup();
    const ac = new AbortController();
    presence.open("user:m1", ac.signal);
    expect(presence.isAlive("user:m1")).toBe(true);
    ac.abort();
    expect(presence.isAlive("user:m1")).toBe(false);
    expect(changes).toEqual([
      { key: "user:m1", alive: true },
      { key: "user:m1", alive: false },
    ]);
  });

  test("stream abierto pero sin latidos → deja de estar viva tras staleMs (cliente caído)", () => {
    const { clock, presence, changes } = setup();
    presence.open("session:s1", new AbortController().signal); // nadie lo aborta nunca
    clock.advance(PRESENCE.staleMs);
    expect(presence.isAlive("session:s1")).toBe(true);
    clock.advance(1);
    expect(presence.isAlive("session:s1")).toBe(false);
    presence.sweep();
    expect(changes.at(-1)).toEqual({ key: "session:s1", alive: false });
  });

  test("un latido la mantiene viva y la revive", () => {
    const { clock, presence } = setup();
    presence.open("user:m2", new AbortController().signal);
    clock.advance(PRESENCE.staleMs - 1);
    presence.touch("user:m2");
    clock.advance(PRESENCE.staleMs - 1);
    expect(presence.isAlive("user:m2")).toBe(true);
    clock.advance(10);
    presence.sweep();
    expect(presence.isAlive("user:m2")).toBe(false);
    presence.touch("user:m2");
    expect(presence.isAlive("user:m2")).toBe(true);
  });

  test("un latido sin stream abierto no la marca viva", () => {
    const { presence } = setup();
    presence.touch("user:nadie");
    expect(presence.isAlive("user:nadie")).toBe(false);
  });
});
