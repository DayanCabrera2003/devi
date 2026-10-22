import { fireEvent, render } from "@testing-library/svelte";
import { describe, expect, test, vi } from "vitest";
import { fakeApp } from "../lib/test-app";
import Settings from "./Settings.svelte";

const autostart = vi.hoisted(() => ({
  isEnabled: vi.fn(async () => false),
  enable: vi.fn(async () => {}),
  disable: vi.fn(async () => {}),
}));
vi.mock("@tauri-apps/plugin-autostart", () => autostart);

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

  test("si no se puede guardar la preferencia de notificaciones, lo dice y la casilla vuelve a su estado", async () => {
    const writeConfig = vi.fn(async () => {
      throw "No se pudo escribir config.json";
    });
    const { context } = await fakeApp({}, { writeConfig });
    const { getByRole, findByText } = render(Settings, { context });
    const box = getByRole("checkbox", { name: "Notificaciones del sistema" }) as HTMLInputElement;
    expect(box.checked).toBe(true);
    await fireEvent.click(box);
    expect(await findByText("No se pudo escribir config.json")).toBeTruthy();
    expect(box.checked).toBe(true);
  });

  test("si falla pausar los avisos, lo dice y no queda en pausa", async () => {
    const setPaused = vi.fn(async () => {
      throw "La bandeja no responde";
    });
    const { app, context } = await fakeApp({}, { setPaused });
    const { getByRole, findByText } = render(Settings, { context });
    const box = getByRole("checkbox", { name: "Pausar avisos por ahora" }) as HTMLInputElement;
    await fireEvent.click(box);
    expect(await findByText("La bandeja no responde")).toBeTruthy();
    expect(box.checked).toBe(false);
    expect(app.paused).toBe(false);
  });

  test("si falla el arranque automático, lo dice y la casilla refleja el estado real", async () => {
    autostart.enable.mockRejectedValueOnce("Sin permiso para el arranque automático");
    const { context } = await fakeApp();
    const { getByRole, findByText } = render(Settings, { context });
    const box = getByRole("checkbox", { name: "Abrir Devi al iniciar sesión" }) as HTMLInputElement;
    await fireEvent.click(box);
    expect(await findByText("Sin permiso para el arranque automático")).toBeTruthy();
    expect(box.checked).toBe(false);
  });

  test("el tema se elige en Apariencia y se guarda en las prefs", async () => {
    const writeConfig = vi.fn(async () => {});
    const { app, context } = await fakeApp({}, { writeConfig });
    const { getByRole } = render(Settings, { context });
    expect((getByRole("radio", { name: "Sistema" }) as HTMLInputElement).checked).toBe(true);
    await fireEvent.click(getByRole("radio", { name: "Oscuro" }));
    await vi.waitFor(() => expect(app.prefs.theme).toBe("dark"));
    expect(writeConfig).toHaveBeenCalledWith(expect.objectContaining({ app: expect.objectContaining({ theme: "dark" }) }));
  });

  test("Mostrar a Devi flotando abre la mascota y guarda la preferencia", async () => {
    const writeConfig = vi.fn(async () => {});
    const setMascotVisible = vi.fn(async () => {});
    const { app, context } = await fakeApp({}, { writeConfig, setMascotVisible });
    const { getByRole, getByText } = render(Settings, { context });
    expect(getByText("Una burbuja con Devi siempre visible, para volver a la app de un clic")).toBeTruthy();
    const box = getByRole("checkbox", { name: /Mostrar a Devi flotando/ }) as HTMLInputElement;
    expect(box.checked).toBe(false);
    await fireEvent.click(box);
    await vi.waitFor(() => expect(app.prefs.showMascot).toBe(true));
    expect(setMascotVisible).toHaveBeenCalledWith(true);
    expect(writeConfig).toHaveBeenCalledWith(expect.objectContaining({ app: expect.objectContaining({ showMascot: true }) }));
    await fireEvent.click(box);
    await vi.waitFor(() => expect(app.prefs.showMascot).toBe(false));
    expect(setMascotVisible).toHaveBeenLastCalledWith(false);
  });

  test("si no se puede guardar la preferencia de la mascota, la vuelve a ocultar y lo dice", async () => {
    const writeConfig = vi.fn(async () => {
      throw "No se pudo escribir config.json";
    });
    const setMascotVisible = vi.fn(async () => {});
    const { app, context } = await fakeApp({}, { writeConfig, setMascotVisible });
    const { getByRole, findByText } = render(Settings, { context });
    const box = getByRole("checkbox", { name: /Mostrar a Devi flotando/ }) as HTMLInputElement;
    await fireEvent.click(box);
    expect(await findByText("No se pudo escribir config.json")).toBeTruthy();
    expect(setMascotVisible.mock.calls).toEqual([[true], [false]]);
    expect(box.checked).toBe(false);
    expect(app.prefs.showMascot).toBe(false);
  });
});
