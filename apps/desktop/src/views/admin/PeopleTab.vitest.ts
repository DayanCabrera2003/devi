import { fireEvent, render } from "@testing-library/svelte";
import { describe, expect, test, vi } from "vitest";
import { fakeApp } from "../../lib/test-app";
import { MARIA, TEAM } from "../../lib/test-fixtures";
import PeopleTab from "./PeopleTab.svelte";

describe("PeopleTab", () => {
  test("lista personas con estado, login y roles; sin desactivarme a mí", async () => {
    const { context } = await fakeApp();
    const { getByText, getAllByRole } = render(PeopleTab, { context });
    expect(getByText("maria@x")).toBeTruthy();
    expect(getByText("conectada")).toBeTruthy();
    expect(getByText("desconectada")).toBeTruthy();
    expect(getByText("Admin")).toBeTruthy();
    expect(getAllByRole("button", { name: "Desactivar" })).toHaveLength(1);
  });

  test("invitar por login envía los campos recortados y vuelve a la tabla", async () => {
    const createMember = vi.fn(async () => ({ ...MARIA, id: "m3" }));
    const { api, context } = await fakeApp({ createMember });
    const { getByRole, getByLabelText, findByText } = render(PeopleTab, { context });
    await fireEvent.click(getByRole("button", { name: "Invitar por login" }));
    await fireEvent.input(getByLabelText("Login de Tailscale"), { target: { value: "  luis@x " } });
    await fireEvent.input(getByLabelText("Nombre"), { target: { value: "Luis" } });
    await fireEvent.click(getByRole("checkbox", { name: "Admin" }));
    await fireEvent.click(getByRole("button", { name: "Invitar" }));
    expect(createMember).toHaveBeenCalledWith({ login: "luis@x", name: "Luis", description: "", roleIds: ["r1"] });
    expect(await findByText("maria@x")).toBeTruthy();
    expect(api.team).toHaveBeenCalledTimes(2); // tras la acción se recarga el equipo
  });

  test("desactivar pide confirmación y luego llama a updateMember con disabled", async () => {
    const updateMember = vi.fn(async () => ({ ...MARIA, disabled: true }));
    const { context } = await fakeApp({ updateMember });
    const { getByRole, queryByRole } = render(PeopleTab, { context });
    await fireEvent.click(getByRole("button", { name: "Desactivar" }));
    expect(updateMember).not.toHaveBeenCalled();
    await fireEvent.click(getByRole("button", { name: "No" }));
    expect(queryByRole("button", { name: "Sí, desactivar" })).toBeNull();
    await fireEvent.click(getByRole("button", { name: "Desactivar" }));
    await fireEvent.click(getByRole("button", { name: "Sí, desactivar" }));
    expect(updateMember).toHaveBeenCalledWith("m2", { disabled: true });
  });

  test("no deja desactivar al último admin", async () => {
    // María es la única con el rol Admin.
    const team = vi.fn(async () => ({
      ...TEAM,
      members: [
        { ...TEAM.members[0]!, roleIds: [] },
        { ...TEAM.members[1]!, roleIds: ["r1"] },
      ],
    }));
    const { context } = await fakeApp({ team });
    const { getByRole, getByText } = render(PeopleTab, { context });
    expect((getByRole("button", { name: "Desactivar" }) as HTMLButtonElement).disabled).toBe(true);
    expect(getByText("Tiene que quedar al menos un admin")).toBeTruthy();
  });

  test("no deja quitarme mi rol de admin si soy el último", async () => {
    const { getByRole, getAllByRole, getByText } = render(PeopleTab, { context: (await fakeApp()).context });
    await fireEvent.click(getAllByRole("button", { name: "Editar" })[0]!); // yo (Dayan)
    const admin = getByRole("checkbox", { name: "Admin" }) as HTMLInputElement;
    expect(admin.checked).toBe(true);
    expect(admin.disabled).toBe(true);
    expect(getByText("Tiene que quedar al menos un admin")).toBeTruthy();
  });

  test("a otra persona sí se le puede dar o quitar el rol de admin", async () => {
    const { getByRole, getAllByRole, queryByText } = render(PeopleTab, { context: (await fakeApp()).context });
    await fireEvent.click(getAllByRole("button", { name: "Editar" })[1]!); // María
    expect((getByRole("checkbox", { name: "Admin" }) as HTMLInputElement).disabled).toBe(false);
    expect(queryByText("Tiene que quedar al menos un admin")).toBeNull();
  });

  test("un 409 last_admin del servidor se muestra en el formulario", async () => {
    const updateMember = vi.fn(async () => {
      throw {
        status: 409,
        body: { error: "No se puede dejar a Devi sin ningún admin: da antes el permiso team.admin a otra persona", code: "last_admin" },
      };
    });
    const { context } = await fakeApp({ updateMember });
    const { getByRole, getAllByRole, findByText } = render(PeopleTab, { context });
    await fireEvent.click(getAllByRole("button", { name: "Editar" })[1]!);
    await fireEvent.click(getByRole("button", { name: "Guardar" }));
    expect(await findByText(/No se puede dejar a Devi sin ningún admin/)).toBeTruthy();
    expect(getByRole("button", { name: "Guardar" })).toBeTruthy(); // el formulario sigue abierto
  });

  test("el login de una persona existente solo se cambia a propósito, con aviso", async () => {
    const updateMember = vi.fn(async () => MARIA);
    const { context } = await fakeApp({ updateMember });
    const { getByRole, getAllByRole, getByLabelText, getByText, queryByText } = render(PeopleTab, { context });
    await fireEvent.click(getAllByRole("button", { name: "Editar" })[1]!);
    const login = getByLabelText("Login de Tailscale") as HTMLInputElement;
    expect(login.readOnly).toBe(true);
    expect(queryByText(/pierde el acceso/)).toBeNull();
    await fireEvent.click(getByRole("button", { name: "Cambiar login" }));
    expect(login.readOnly).toBe(false);
    expect(getByText(/pierde el acceso hasta que se conecte con el nuevo login/)).toBeTruthy();
    await fireEvent.input(login, { target: { value: "maria@nuevo" } });
    await fireEvent.click(getByRole("button", { name: "Guardar" }));
    expect(updateMember).toHaveBeenCalledWith("m2", expect.objectContaining({ login: "maria@nuevo" }));
  });

  test("si el servidor rechaza la invitación, el error se ve en el formulario", async () => {
    const createMember = vi.fn(async () => {
      throw { status: 409, body: { error: "Ya existe una persona con ese login" } };
    });
    const { context } = await fakeApp({ createMember });
    const { getByRole, getByLabelText, findByText } = render(PeopleTab, { context });
    await fireEvent.click(getByRole("button", { name: "Invitar por login" }));
    await fireEvent.input(getByLabelText("Login de Tailscale"), { target: { value: "maria@x" } });
    await fireEvent.input(getByLabelText("Nombre"), { target: { value: "María" } });
    await fireEvent.click(getByRole("button", { name: "Invitar" }));
    expect(await findByText("Ya existe una persona con ese login")).toBeTruthy();
  });
});
