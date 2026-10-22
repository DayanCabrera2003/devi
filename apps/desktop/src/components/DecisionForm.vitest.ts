import { fireEvent, render } from "@testing-library/svelte";
import { describe, expect, test, vi } from "vitest";
import DecisionForm from "./DecisionForm.svelte";

const base = { fromName: "María", message: "¿Me apruebas el PR?", onBack: vi.fn() };

describe("DecisionForm", () => {
  test("rechazar exige motivo y lo envía recortado", async () => {
    const onConfirm = vi.fn(async () => {});
    const { getByRole } = render(DecisionForm, { ...base, kind: "reject", onConfirm });
    const confirm = getByRole("button", { name: "Confirmar rechazo" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await fireEvent.input(getByRole("textbox"), { target: { value: "  no tengo acceso  " } });
    expect(confirm.disabled).toBe(false);
    await fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith("no tengo acceso", false);
  });

  test("aceptar no exige nota", async () => {
    const onConfirm = vi.fn(async () => {});
    const { getByRole } = render(DecisionForm, { ...base, kind: "accept", onConfirm });
    const confirm = getByRole("button", { name: "Confirmar: lo hago yo" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
    await fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith("", false);
  });

  test("muestra el error del servidor y permite reintentar", async () => {
    const onConfirm = vi.fn(async () => Promise.reject({ status: 409, body: { error: "Ya estaba respondida" } }));
    const { getByRole, findByText } = render(DecisionForm, { ...base, kind: "accept", onConfirm });
    await fireEvent.click(getByRole("button", { name: "Confirmar: lo hago yo" }));
    expect(await findByText("Ya estaba respondida")).toBeTruthy();
    expect((getByRole("button", { name: "Confirmar: lo hago yo" }) as HTMLButtonElement).disabled).toBe(false);
  });

  test("aceptar: casilla «Guardar en la base del equipo», solo con nota; la decisión llega a onConfirm", async () => {
    const onConfirm = vi.fn(async () => {});
    const { getByRole } = render(DecisionForm, { ...base, kind: "accept", onConfirm });
    const share = getByRole("checkbox", { name: /Guardar en la base del equipo/ }) as HTMLInputElement;
    expect(share.disabled).toBe(true);
    await fireEvent.input(getByRole("textbox"), { target: { value: "Hecho: rol viewer en GCP" } });
    expect(share.disabled).toBe(false);
    await fireEvent.click(share);
    await fireEvent.click(getByRole("button", { name: "Confirmar: lo hago yo" }));
    expect(onConfirm).toHaveBeenCalledWith("Hecho: rol viewer en GCP", true);
  });

  test("rechazar no ofrece guardar en la base", () => {
    const { queryByRole } = render(DecisionForm, { ...base, kind: "reject", onConfirm: vi.fn(async () => {}) });
    expect(queryByRole("checkbox")).toBeNull();
  });
});
