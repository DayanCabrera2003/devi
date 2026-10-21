import { expect, test } from "bun:test";
import { DeviApiError } from "@devi/client";
import { readableError } from "./errors";

test("human_only: explica que la acción es de la app, no del agente", () => {
  const msg = readableError(new DeviApiError(403, { error: "x", code: "human_only" }));
  expect(msg).toContain("solo se puede hacer desde la app de Devi");
});

test("sin conexión añade que no se puede enviar nada", () => {
  expect(readableError(new DeviApiError(0, { error: "caído", code: "unreachable" }))).toContain("No se puede enviar nada");
});
