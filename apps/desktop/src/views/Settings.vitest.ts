import { fireEvent, render } from "@testing-library/svelte";
import { describe, expect, test, vi } from "vitest";
import { fakeApp } from "../lib/test-app";
import Settings from "./Settings.svelte";

vi.mock("@tauri-apps/plugin-autostart", () => ({
  isEnabled: vi.fn(async () => false),
  enable: vi.fn(async () => {}),
  disable: vi.fn(async () => {}),
}));

describe("Settings", () => {
  test("una URL no válida no se guarda y explica por qué", async () => {
    const { app, context } = await fakeApp();
    const changeServer = vi.spyOn(app, "changeServer");
    const { getByLabelText, getByRole, findByText } = render(Settings, { context });
    await fireEvent.input(getByLabelText("URL del servidor de Devi"), { target: { value: "http://pc.tail1.ts.net" } });
    await fireEvent.click(getByRole("button", { name: "Guardar y reconectar" }));
    expect(await findByText("La URL debe empezar por https://")).toBeTruthy();
    expect(changeServer).not.toHaveBeenCalled();
  });

  test("una URL válida reconecta con la URL normalizada", async () => {
    const { app, context } = await fakeApp();
    const changeServer = vi.spyOn(app, "changeServer").mockResolvedValue();
    const { getByLabelText, getByRole, findByText } = render(Settings, { context });
    await fireEvent.input(getByLabelText("URL del servidor de Devi"), { target: { value: " https://otro.tail1.ts.net/ " } });
    await fireEvent.click(getByRole("button", { name: "Guardar y reconectar" }));
    expect(await findByText("Guardado. Reconectando…")).toBeTruthy();
    expect(changeServer).toHaveBeenCalledWith("https://otro.tail1.ts.net");
  });

  test("sin modo servidor no muestra el panel del servidor local", async () => {
    const { context } = await fakeApp();
    const { queryByText } = render(Settings, { context });
    expect(queryByText("Este equipo es el servidor")).toBeNull();
  });
});
