import { fireEvent, render } from "@testing-library/svelte";
import { describe, expect, test, vi } from "vitest";
import { fakeApp } from "../../lib/test-app";
import { SESSIONS } from "../../lib/test-fixtures";
import ServerTab from "./ServerTab.svelte";

const SETTINGS = { requestTimeoutMs: 3_600_000, draftTtlMs: 900_000, fileRetentionDays: 7, fileMaxAgeDays: 30 };

async function setup(over: Record<string, unknown> = {}) {
  const updateSettings = vi.fn(async (b: object) => ({ ...SETTINGS, ...b }));
  const t = await fakeApp({
    health: vi.fn(async () => ({ ok: true, version: "0.3.0" })),
    getSettings: vi.fn(async () => SETTINGS),
    updateSettings,
    memberSessions: vi.fn(async () => SESSIONS),
    ...over,
  });
  const view = render(ServerTab, { context: t.context });
  await view.findByDisplayValue("60"); // ajustes cargados
  return { ...t, ...view, updateSettings };
}

describe("ServerTab", () => {
  test("muestra URL, versión, conectados y sesiones abiertas", async () => {
    const { getByText, findByText } = await setup();
    expect(getByText("https://pc.t.ts.net")).toBeTruthy();
    expect(await findByText("0.3.0")).toBeTruthy();
    expect(await findByText("2")).toBeTruthy(); // sesiones de la única persona conectada
  });

  test("guarda los ajustes convertidos a milisegundos", async () => {
    const { updateSettings, getByLabelText, getByRole, findByText } = await setup();
    await fireEvent.input(getByLabelText(/Timeout de una solicitud/), { target: { value: "120" } });
    await fireEvent.click(getByRole("button", { name: "Guardar" }));
    expect(updateSettings).toHaveBeenCalledWith({ ...SETTINGS, requestTimeoutMs: 7_200_000 });
    expect(await findByText("Ajustes guardados.")).toBeTruthy();
  });

  test("fuera de los rangos del servidor no envía nada y lo explica", async () => {
    const { updateSettings, getByLabelText, getByRole, getByText } = await setup();
    await fireEvent.input(getByLabelText(/Tiempo para autorizar/), { target: { value: "2000" } });
    await fireEvent.input(getByLabelText(/Borrar archivos siempre/), { target: { value: "3" } });
    await fireEvent.click(getByRole("button", { name: "Guardar" }));
    expect(updateSettings).not.toHaveBeenCalled();
    expect(getByText(/24 horas/, { selector: ".error" })).toBeTruthy();
    expect(getByText(/menor que la retención/)).toBeTruthy();
  });

  test("si el servidor responde 400 se muestra su mensaje", async () => {
    const updateSettings = vi.fn(async () => {
      throw { status: 400, body: { error: "fileMaxAgeDays: Too big", code: "invalid" } };
    });
    const { getByRole, findByText } = await setup({ updateSettings });
    await fireEvent.click(getByRole("button", { name: "Guardar" }));
    expect(await findByText("fileMaxAgeDays: Too big")).toBeTruthy();
  });
});
