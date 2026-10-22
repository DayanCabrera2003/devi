import { fireEvent, render } from "@testing-library/svelte";
import { describe, expect, test, vi } from "vitest";
import { fakeApp } from "../../lib/test-app";
import EscalationSetting from "./EscalationSetting.svelte";

const SETTINGS = { requestTimeoutMs: 3_600_000, draftTtlMs: 900_000, fileRetentionDays: 7, fileMaxAgeDays: 30, allowedDomains: [], chatApproval: true, escalateAfterMs: 1_800_000 };

async function setup(over: Record<string, unknown> = {}, settings = SETTINGS) {
  const updateSettings = vi.fn(async (b: object) => ({ ...settings, ...b }));
  const t = await fakeApp({ updateSettings, ...over });
  const onSaved = vi.fn();
  const view = render(EscalationSetting, { props: { settings, onSaved }, context: t.context });
  return { ...view, updateSettings, onSaved };
}

describe("EscalationSetting", () => {
  test("muestra el plazo en minutos y guarda el cambio en milisegundos", async () => {
    const { getByLabelText, getByRole, updateSettings, onSaved, findByText } = await setup();
    const box = getByLabelText("Avisar si una solicitud sigue sin respuesta") as HTMLInputElement;
    expect(box.checked).toBe(true);
    const min = getByLabelText(/Plazo para avisar/) as HTMLInputElement;
    expect(min.value).toBe("30");
    await fireEvent.input(min, { target: { value: "45" } });
    await fireEvent.click(getByRole("button", { name: "Guardar plazo" }));
    expect(updateSettings).toHaveBeenCalledWith({ escalateAfterMs: 2_700_000 });
    expect(onSaved).toHaveBeenCalled();
    expect(await findByText("Plazo guardado.")).toBeTruthy();
  });

  test("desactivarlo guarda null al momento; activarlo vuelve a 30 min si no había plazo", async () => {
    const { getByLabelText, updateSettings } = await setup();
    await fireEvent.click(getByLabelText("Avisar si una solicitud sigue sin respuesta"));
    expect(updateSettings).toHaveBeenLastCalledWith({ escalateAfterMs: null });
    const off = await setup({}, { ...SETTINGS, escalateAfterMs: null as unknown as number });
    const boxes = off.getAllByLabelText("Avisar si una solicitud sigue sin respuesta");
    await fireEvent.click(boxes.at(-1)!);
    expect(off.updateSettings).toHaveBeenLastCalledWith({ escalateAfterMs: 1_800_000 });
  });

  test("fuera de 5 min–24 h o no menor que el timeout: no envía nada y lo explica", async () => {
    const { getByLabelText, getByRole, updateSettings, findByText } = await setup();
    const min = getByLabelText(/Plazo para avisar/);
    await fireEvent.input(min, { target: { value: "4" } });
    await fireEvent.click(getByRole("button", { name: "Guardar plazo" }));
    expect(await findByText(/entre 5 minutos y 24 horas/, { selector: ".error" })).toBeTruthy();
    await fireEvent.input(min, { target: { value: "60" } });
    await fireEvent.click(getByRole("button", { name: "Guardar plazo" }));
    expect(await findByText(/menor que el timeout/, { selector: ".error" })).toBeTruthy();
    expect(updateSettings).not.toHaveBeenCalled();
  });
});
