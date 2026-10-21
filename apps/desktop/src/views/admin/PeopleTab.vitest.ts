import { fireEvent, render } from "@testing-library/svelte";
import { describe, expect, test, vi } from "vitest";
import { fakeApp } from "../../lib/test-app";
import { MARIA } from "../../lib/test-fixtures";
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

  test("desactivar llama a updateMember con disabled", async () => {
    const updateMember = vi.fn(async () => ({ ...MARIA, disabled: true }));
    const { context } = await fakeApp({ updateMember });
    const { getByRole } = render(PeopleTab, { context });
    await fireEvent.click(getByRole("button", { name: "Desactivar" }));
    expect(updateMember).toHaveBeenCalledWith("m2", { disabled: true });
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
