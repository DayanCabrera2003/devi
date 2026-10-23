import { fireEvent, render } from "@testing-library/svelte";
import { afterEach, describe, expect, test, vi } from "vitest";
import { fakeApp } from "../lib/test-app";
import { draft, req } from "../lib/test-fixtures";
import DraftCard from "./DraftCard.svelte";
import RequestCard from "./RequestCard.svelte";

// Traspaso de sesión: una solicitud con kind "handoff".

const handoff = req({ id: "3f9a1c2e", kind: "handoff", message: "Estado: login hecho. Próximo paso: tests." });

function mockClipboard(writeText: (t: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
}

afterEach(() => {
  Reflect.deleteProperty(navigator, "clipboard");
});

describe("RequestCard: traspaso", () => {
  test("título «Traspaso de <nombre>», Enviar a mi sesión y Abrir en sesión nueva", async () => {
    const { context } = await fakeApp();
    const { getByText, getByRole } = render(RequestCard, { props: { request: handoff }, context });
    expect(getByText("Traspaso de María")).toBeTruthy();
    expect(getByRole("button", { name: "Enviar a mi sesión" })).toBeTruthy();
    expect(getByRole("button", { name: "Abrir en sesión nueva" })).toBeTruthy();
    expect(getByRole("button", { name: "Aceptar" })).toBeTruthy();
  });

  test("Abrir en sesión nueva crea un código para el traspaso y copia la frase", async () => {
    const writeText = vi.fn(async () => {});
    mockClipboard(writeText);
    const createClaim = vi.fn(async () => ({ code: "K7Q4MX", target: { type: "request", id: "3f9a1c2e" }, expiresAt: Date.now() + 600_000, status: "open" }));
    const { context } = await fakeApp({ createClaim });
    const { getByRole, findByText } = render(RequestCard, { props: { request: handoff }, context });
    await fireEvent.click(getByRole("button", { name: "Abrir en sesión nueva" }));
    await fireEvent.click(getByRole("button", { name: "Crear código" }));
    expect(await findByText("devi: recibir K7Q-4MX")).toBeTruthy();
    expect(createClaim).toHaveBeenCalledWith({ type: "request", id: "3f9a1c2e" });
    expect(writeText).toHaveBeenCalledWith("devi: recibir K7Q-4MX");
    expect(await findByText("Esperando sesión nueva · K7Q-4MX")).toBeTruthy();
  });

  test("una solicitud normal no cambia", async () => {
    const { context } = await fakeApp();
    const { queryByText, queryByRole, getByRole } = render(RequestCard, { props: { request: req() }, context });
    expect(queryByText(/Traspaso de/)).toBeNull();
    expect(queryByRole("button", { name: "Abrir en sesión nueva" })).toBeNull();
    expect(getByRole("button", { name: "Lo hago yo" })).toBeTruthy();
  });
});

test("DraftCard: el borrador de un traspaso lo dice", async () => {
  const { context } = await fakeApp();
  const { getByText } = render(DraftCard, { props: { draft: draft({ requestKind: "handoff" }) }, context });
  expect(getByText("Tu agente quiere enviar este traspaso a María")).toBeTruthy();
});
