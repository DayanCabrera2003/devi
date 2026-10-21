import { describe, expect, test } from "bun:test";
import { FakeClock, RealTimers } from "./clock";

describe("FakeClock", () => {
  test("after se ejecuta al avanzar y se puede cancelar", () => {
    const c = new FakeClock(0);
    const log: string[] = [];
    c.after(100, () => log.push("a"));
    const cancel = c.after(50, () => log.push("b"));
    cancel();
    c.advance(99);
    expect(log).toEqual([]);
    c.advance(1);
    expect(log).toEqual(["a"]);
    expect(c.now()).toBe(100);
  });

  test("ejecuta en orden y con el reloj en el momento del vencimiento", () => {
    const c = new FakeClock(0);
    const seen: number[] = [];
    c.after(30, () => seen.push(c.now()));
    c.after(10, () => seen.push(c.now()));
    c.advance(100);
    expect(seen).toEqual([10, 30]);
    expect(c.now()).toBe(100);
  });

  test("every se repite; un temporizador puede programar otro", () => {
    const c = new FakeClock(0);
    let n = 0;
    c.every(10, () => n++);
    c.after(5, () => c.after(5, () => n += 100));
    c.advance(35);
    expect(n).toBe(103);
    c.stopAll();
    c.advance(100);
    expect(n).toBe(103);
  });
});

test("RealTimers cancela todo con stopAll", async () => {
  const t = new RealTimers();
  let fired = false;
  t.after(5, () => (fired = true));
  t.every(5, () => (fired = true));
  t.stopAll();
  await Bun.sleep(20);
  expect(fired).toBe(false);
});
