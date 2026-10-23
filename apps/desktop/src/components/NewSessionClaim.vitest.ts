import { fireEvent, render, waitFor } from "@testing-library/svelte";
import { describe, expect, test, vi } from "vitest";
import NewSessionClaim from "./NewSessionClaim.svelte";

// Con { props }: la prop target chocaría con la opción target de mount().

describe("NewSessionClaim", () => {
  test("crea el código, lo copia y explica dónde pegarlo", async () => {
    const create = vi.fn(async () => ({ code: "K7Q4MX", target: { type: "request" as const, id: "r1" }, expiresAt: Date.now() + 600_000, status: "open" as const }));
    const copy = vi.fn(async () => true);
    const { getByText, findByText } = render(NewSessionClaim, { props: { target: { type: "request", id: "r1" }, create, cancel: vi.fn(), copy, onBack: vi.fn() } });
    expect(getByText(/Llegará como pregunta abierta, no como orden/)).toBeTruthy();
    await fireEvent.click(getByText("Crear código"));
    expect(await findByText("devi: recibir K7Q-4MX")).toBeTruthy();
    expect(create).toHaveBeenCalledWith({ type: "request", id: "r1" });
    expect(copy).toHaveBeenCalledWith("devi: recibir K7Q-4MX");
    expect(getByText(/primer mensaje/)).toBeTruthy();
  });

  test("cancelar llama a la API", async () => {
    const create = vi.fn(async () => ({ code: "K7Q4MX", target: { type: "chat" as const, id: "m1" }, expiresAt: Date.now() + 600_000, status: "open" as const }));
    const cancel = vi.fn(async () => {});
    const onBack = vi.fn();
    const { getByText, findByText } = render(NewSessionClaim, { props: { target: { type: "chat", id: "m1" }, create, cancel, copy: vi.fn(async () => true), onBack } });
    await fireEvent.click(getByText("Crear código"));
    await fireEvent.click(await findByText("Cancelar código"));
    await waitFor(() => expect(cancel).toHaveBeenCalledWith("K7Q4MX"));
    await waitFor(() => expect(onBack).toHaveBeenCalled());
  });

  test("si el servidor rechaza el código, enseña su mensaje", async () => {
    const create = vi.fn(async () => {
      throw new Error("Tienes demasiados códigos sin usar: usa o cancela alguno");
    });
    const { getByText, findByText } = render(NewSessionClaim, { props: { target: { type: "request", id: "r1" }, create, cancel: vi.fn(), copy: vi.fn(async () => true), onBack: vi.fn() } });
    await fireEvent.click(getByText("Crear código"));
    expect(await findByText(/demasiados códigos sin usar/)).toBeTruthy();
  });
});
