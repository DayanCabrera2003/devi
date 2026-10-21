import { PERMS, PERM_LABELS } from "@devi/protocol";
import { fireEvent, render } from "@testing-library/svelte";
import { describe, expect, test, vi } from "vitest";
import { fakeApp } from "../../lib/test-app";
import RolesTab from "./RolesTab.svelte";

describe("RolesTab", () => {
  test("crear un rol con capacidades y permisos", async () => {
    const createRole = vi.fn(async (b: Record<string, unknown>) => ({ id: "r2", ...b }));
    const { context } = await fakeApp({ createRole });
    const { getByRole, getByLabelText, findByText } = render(RolesTab, { context });
    await fireEvent.click(getByRole("button", { name: "+ Nuevo rol" }));
    for (const p of PERMS) expect(getByRole("checkbox", { name: new RegExp(PERM_LABELS[p]) })).toBeTruthy();
    await fireEvent.input(getByLabelText("Nombre"), { target: { value: " Backend " } });
    await fireEvent.input(getByLabelText("Nueva capacidad"), { target: { value: "Aprobar PRs de backend" } });
    await fireEvent.click(getByRole("button", { name: "Añadir" }));
    await fireEvent.click(getByRole("checkbox", { name: new RegExp(PERM_LABELS["requests.send"]) }));
    await fireEvent.click(getByRole("button", { name: "Crear rol" }));
    expect(createRole).toHaveBeenCalledWith({
      name: "Backend",
      color: "#4a7bd8",
      capabilities: ["Aprobar PRs de backend"],
      perms: ["requests.send"],
    });
    expect(await findByText("Guardado.")).toBeTruthy();
  });

  test("borrar pide confirmación", async () => {
    const deleteRole = vi.fn(async () => ({ ok: true }));
    const { context } = await fakeApp({ deleteRole });
    const { getByRole, findByText } = render(RolesTab, { context });
    await fireEvent.click(getByRole("button", { name: /Admin/ }));
    await fireEvent.click(getByRole("button", { name: "Borrar rol" }));
    expect(deleteRole).not.toHaveBeenCalled();
    await fireEvent.click(getByRole("button", { name: "Sí, borrar" }));
    expect(deleteRole).toHaveBeenCalledWith("r1");
    expect(await findByText("Elige un rol o crea uno nuevo.")).toBeTruthy();
  });
});
