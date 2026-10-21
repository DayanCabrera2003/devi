import { PERMS, PERM_LABELS } from "@devi/protocol";
import { fireEvent, render } from "@testing-library/svelte";
import { describe, expect, test, vi } from "vitest";
import { fakeApp } from "../../lib/test-app";
import { TEAM } from "../../lib/test-fixtures";

const DEV = { id: "r2", name: "Dev", color: "#00ff00", capabilities: [], perms: ["requests.send"] };
// Dos roles de admin: quitar o borrar uno no deja al equipo sin admin.
const JEFA = { id: "r3", name: "Jefa", color: "#ff0000", capabilities: [], perms: ["team.admin"] };
const withRoles = (...extra: object[]) =>
  vi.fn(async () => ({
    members: [{ ...TEAM.members[0]!, roleIds: ["r1", "r3"] }, TEAM.members[1]!],
    roles: [...TEAM.roles, ...extra],
  }));
const LAST_ADMIN_409 = {
  status: 409,
  body: { error: "No se puede dejar a Devi sin ningún admin: da antes el permiso team.admin a otra persona", code: "last_admin" },
};
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
    const { context } = await fakeApp({ deleteRole, team: withRoles(JEFA) });
    const { getByRole, findByText } = render(RolesTab, { context });
    await fireEvent.click(getByRole("button", { name: /Admin/ }));
    await fireEvent.click(getByRole("button", { name: "Borrar rol" }));
    expect(deleteRole).not.toHaveBeenCalled();
    await fireEvent.click(getByRole("button", { name: "Sí, borrar" }));
    expect(deleteRole).toHaveBeenCalledWith("r1");
    expect(await findByText("Elige un rol o crea uno nuevo.")).toBeTruthy();
  });

  test("los permisos se ven por su nombre; el ID solo en el title", async () => {
    const { context } = await fakeApp();
    const { getByRole, queryByText } = render(RolesTab, { context });
    await fireEvent.click(getByRole("button", { name: "+ Nuevo rol" }));
    for (const p of PERMS) {
      expect(queryByText(p)).toBeNull();
      expect(getByRole("checkbox", { name: PERM_LABELS[p] }).closest("label")?.title).toBe(p);
    }
  });

  test("el único rol que da team.admin no pierde ese permiso ni se puede borrar", async () => {
    const { context } = await fakeApp({ team: withRoles(DEV) });
    // Solo r1 da team.admin; en withRoles Dayan además tiene r3, que no existe aquí.
    const { getByRole, getAllByText } = render(RolesTab, { context });
    await fireEvent.click(getByRole("button", { name: /Admin/ }));
    const perm = getByRole("checkbox", { name: PERM_LABELS["team.admin"] }) as HTMLInputElement;
    expect(perm.checked).toBe(true);
    expect(perm.disabled).toBe(true);
    expect((getByRole("button", { name: "Borrar rol" }) as HTMLButtonElement).disabled).toBe(true);
    expect(getAllByText("Tiene que quedar al menos un admin").length).toBeGreaterThan(0);
  });

  test("con otro rol de admin activo sí se puede quitar team.admin", async () => {
    const { context } = await fakeApp({ team: withRoles(JEFA) });
    const { getByRole, queryByText } = render(RolesTab, { context });
    await fireEvent.click(getByRole("button", { name: /Admin/ }));
    expect((getByRole("checkbox", { name: PERM_LABELS["team.admin"] }) as HTMLInputElement).disabled).toBe(false);
    expect((getByRole("button", { name: "Borrar rol" }) as HTMLButtonElement).disabled).toBe(false);
    expect(queryByText("Tiene que quedar al menos un admin")).toBeNull();
  });

  test("un 409 last_admin del servidor se muestra en el editor", async () => {
    const updateRole = vi.fn(async () => {
      throw LAST_ADMIN_409;
    });
    const { context } = await fakeApp({ updateRole, team: withRoles(JEFA) });
    const { getByRole, findByText } = render(RolesTab, { context });
    await fireEvent.click(getByRole("button", { name: /Jefa/ }));
    await fireEvent.click(getByRole("checkbox", { name: PERM_LABELS["team.admin"] }));
    await fireEvent.click(getByRole("button", { name: "Guardar" }));
    expect(updateRole).toHaveBeenCalled();
    expect(await findByText(/No se puede dejar a Devi sin ningún admin/)).toBeTruthy();
  });
});
