import { expect, test } from "bun:test";
import { Bus } from "./bus";

test("entrega a los suscriptores y permite darse de baja", () => {
  const bus = new Bus();
  const got: number[] = [];
  const off = bus.on<number>("x", (n) => got.push(n));
  bus.emit("x", 1);
  off();
  bus.emit("x", 2);
  expect(got).toEqual([1]);
});

test("un suscriptor que falla no impide a los demás", () => {
  const bus = new Bus(() => {});
  const got: string[] = [];
  bus.on("y", () => {
    throw new Error("boom");
  });
  bus.on<string>("y", (s) => got.push(s));
  bus.emit("y", "ok");
  expect(got).toEqual(["ok"]);
});
