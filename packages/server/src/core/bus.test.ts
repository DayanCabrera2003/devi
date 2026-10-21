import { expect, test } from "bun:test";
import { Bus } from "./bus";

// Así amplía un módulo los eventos del bus sin editar el núcleo.
declare module "./bus" {
  interface BusEvents {
    "test.number": number;
    "test.string": string;
  }
}

test("entrega a los suscriptores y permite darse de baja", () => {
  const bus = new Bus();
  const got: number[] = [];
  const off = bus.on("test.number", (n) => got.push(n));
  bus.emit("test.number", 1);
  off();
  bus.emit("test.number", 2);
  expect(got).toEqual([1]);
});

test("un suscriptor que falla no impide a los demás", () => {
  const bus = new Bus(() => {});
  const got: string[] = [];
  bus.on("test.string", () => {
    throw new Error("boom");
  });
  bus.on("test.string", (s) => got.push(s));
  bus.emit("test.string", "ok");
  expect(got).toEqual(["ok"]);
});

test("el payload está tipado", () => {
  const bus = new Bus();
  // @ts-expect-error el payload de "test.number" es number
  bus.emit("test.number", "no es número");
  // @ts-expect-error evento no declarado
  bus.emit("test.desconocido", 1);
});
