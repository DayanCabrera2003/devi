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
  test("título «Traspaso de <nombre>», Enviar a mi sesión y Empezar sesión con esto", async () => {
    const { context } = await fakeApp();
    const { getByText, getByRole } = render(RequestCard, { props: { request: handoff }, context });
    expect(getByText("Traspaso de María")).toBeTruthy();
    expect(getByRole("button", { name: "Enviar a mi sesión" })).toBeTruthy();
    expect(getByRole("button", { name: "Empezar sesión con esto" })).toBeTruthy();
    expect(getByRole("button", { name: "Aceptar" })).toBeTruthy();
  });

  test("Empezar sesión con esto copia «devi claude --handoff <id>» y lo enseña", async () => {
    const writeText = vi.fn(async () => {});
    mockClipboard(writeText);
    const { context } = await fakeApp();
    const { getByRole, findByText, getByText } = render(RequestCard, { props: { request: handoff }, context });
    await fireEvent.click(getByRole("button", { name: "Empezar sesión con esto" }));
    expect(writeText).toHaveBeenCalledWith("devi claude --handoff 3f9a1c2e");
    expect(await findByText(/Copiado/)).toBeTruthy();
    expect(getByText("devi claude --handoff 3f9a1c2e")).toBeTruthy();
  });

  test("si el portapapeles falla, el comando queda a la vista para copiarlo a mano", async () => {
    mockClipboard(async () => {
      throw new Error("denegado");
    });
    const { context } = await fakeApp();
    const { getByRole, findByText, getByText } = render(RequestCard, { props: { request: handoff }, context });
    await fireEvent.click(getByRole("button", { name: "Empezar sesión con esto" }));
    expect(await findByText(/cópialo a mano/)).toBeTruthy();
    expect(getByText("devi claude --handoff 3f9a1c2e")).toBeTruthy();
  });

  test("una solicitud normal no cambia", async () => {
    const { context } = await fakeApp();
    const { queryByText, queryByRole, getByRole } = render(RequestCard, { props: { request: req() }, context });
    expect(queryByText(/Traspaso de/)).toBeNull();
    expect(queryByRole("button", { name: "Empezar sesión con esto" })).toBeNull();
    expect(getByRole("button", { name: "Lo hago yo" })).toBeTruthy();
  });
});

test("DraftCard: el borrador de un traspaso lo dice", async () => {
  const { context } = await fakeApp();
  const { getByText } = render(DraftCard, { props: { draft: draft({ requestKind: "handoff" }) }, context });
  expect(getByText("Tu agente quiere enviar este traspaso a María")).toBeTruthy();
});
