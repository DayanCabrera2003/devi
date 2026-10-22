import { fireEvent, render } from "@testing-library/svelte";
import { describe, expect, test, vi } from "vitest";
import { fakeApp } from "../../lib/test-app";
import SessionNoticesSetting from "./SessionNoticesSetting.svelte";

const flush = () => new Promise((r) => setTimeout(r, 0));
const LABEL = /Avisar en mis sesiones de Claude Code/;

async function setup(api: Record<string, unknown>) {
  const t = await fakeApp(api);
  const view = render(SessionNoticesSetting, { context: t.context });
  await flush();
  return { ...view, box: view.getByRole("checkbox", { name: LABEL }) as HTMLInputElement };
}

describe("SessionNoticesSetting", () => {
  test("refleja la preferencia guardada en el servidor y la cambia", async () => {
    const updateMyPrefs = vi.fn(async (b: object) => ({ sessionNotices: true, ...b }));
    const v = await setup({ myPrefs: vi.fn(async () => ({ sessionNotices: true })), updateMyPrefs });
    expect(v.box.checked).toBe(true);
    await fireEvent.click(v.box);
    await flush();
    expect(updateMyPrefs).toHaveBeenCalledWith({ sessionNotices: false });
    expect(v.box.checked).toBe(false);
  });

  test("si falla al guardar, lo dice y la casilla vuelve a su estado real", async () => {
    const updateMyPrefs = vi.fn(async () => {
      throw new Error("sin conexión");
    });
    const v = await setup({ myPrefs: vi.fn(async () => ({ sessionNotices: false })), updateMyPrefs });
    expect(v.box.checked).toBe(false);
    await fireEvent.click(v.box);
    await flush();
    expect(v.box.checked).toBe(false);
    expect(v.getByText(/sin conexión/)).toBeTruthy();
  });

  test("explica para qué sirve (Remote Control) y que se trae o rechaza desde la sesión", async () => {
    const v = await setup({ myPrefs: vi.fn(async () => ({ sessionNotices: true })) });
    expect(v.getByText(/Remote Control/)).toBeTruthy();
  });
});
