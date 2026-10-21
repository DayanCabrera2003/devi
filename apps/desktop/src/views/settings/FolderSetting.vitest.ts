import { fireEvent, render } from "@testing-library/svelte";
import { describe, expect, test, vi } from "vitest";
import { fakeApp } from "../../lib/test-app";
import FolderSetting from "./FolderSetting.svelte";

const CONFIG = { serverUrl: "https://pc.t.ts.net", app: { notifications: true, setupDone: true } };

describe("FolderSetting", () => {
  test("sin carpeta propia muestra la de por defecto y sin botón de restablecer", async () => {
    const { context } = await fakeApp();
    const { getByText, queryByRole } = render(FolderSetting, { context });
    expect(getByText("~/Devi/recibidos (por defecto)")).toBeTruthy();
    expect(queryByRole("button", { name: "Usar la de por defecto" })).toBeNull();
  });

  test("Cambiar… abre el diálogo de Rust y muestra la carpeta elegida", async () => {
    const chooseReceivedDir = vi.fn(async () => ({ ...CONFIG, receivedDir: "/home/d/Recibidos" }));
    const { context } = await fakeApp({}, { chooseReceivedDir });
    const { getByRole, findByText } = render(FolderSetting, { context });
    await fireEvent.click(getByRole("button", { name: "Cambiar…" }));
    expect(chooseReceivedDir).toHaveBeenCalled();
    expect(await findByText("/home/d/Recibidos")).toBeTruthy();
  });

  test("cancelar el diálogo no cambia nada", async () => {
    const { context } = await fakeApp({}, { chooseReceivedDir: vi.fn(async () => null) });
    const { getByRole, findByText } = render(FolderSetting, { context });
    await fireEvent.click(getByRole("button", { name: "Cambiar…" }));
    expect(await findByText("~/Devi/recibidos (por defecto)")).toBeTruthy();
  });

  test("con carpeta propia se puede volver a la de por defecto", async () => {
    const resetReceivedDir = vi.fn(async () => CONFIG);
    const { app, context } = await fakeApp({}, { resetReceivedDir });
    app.config = { ...CONFIG, receivedDir: "/otra" };
    const { getByRole, findByText } = render(FolderSetting, { context });
    await fireEvent.click(getByRole("button", { name: "Usar la de por defecto" }));
    expect(resetReceivedDir).toHaveBeenCalled();
    expect(await findByText("~/Devi/recibidos (por defecto)")).toBeTruthy();
  });

  test("un error de Rust se muestra", async () => {
    const chooseReceivedDir = vi.fn(async () => {
      throw "La carpeta no se puede escribir";
    });
    const { context } = await fakeApp({}, { chooseReceivedDir });
    const { getByRole, findByText } = render(FolderSetting, { context });
    await fireEvent.click(getByRole("button", { name: "Cambiar…" }));
    expect(await findByText("La carpeta no se puede escribir")).toBeTruthy();
  });
});
