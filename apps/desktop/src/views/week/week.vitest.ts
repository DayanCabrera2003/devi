import { fireEvent, render } from "@testing-library/svelte";
import { describe, expect, test, vi } from "vitest";
import { fakeApp } from "../../lib/test-app";
import WeekBanner from "./WeekBanner.svelte";
import WeekView from "./WeekView.svelte";

const MONDAY = new Date(2026, 9, 19, 10).getTime();
const TUESDAY = new Date(2026, 9, 20, 10).getTime();
const WEEK = { from: 0, to: 1, sent: 3, received: 4, answered: 2, avgResponseMs: 12 * 60_000, topHelped: [{ memberId: "m2", count: 2 }] };
const EMPTY = { from: 0, to: 1, sent: 0, received: 0, answered: 0, avgResponseMs: null, topHelped: [] };

async function setup(now: number, week: object = WEEK) {
  const myWeek = vi.fn(async () => week);
  const writeConfig = vi.fn(async () => {});
  // Con el canal abierto: la tarjeta de los lunes espera a estar conectada.
  const subscribe = vi.fn((_: unknown, onStatus: (s: string) => void) => {
    onStatus("open");
    return () => {};
  });
  const t = await fakeApp({ myWeek, subscribe }, { writeConfig });
  t.app.clock.now = now;
  return { ...t, myWeek, writeConfig };
}

describe("Tu semana", () => {
  test("los lunes sale sola en la barra lateral con los números de la semana", async () => {
    const { context } = await setup(MONDAY);
    const { findByText, getByText } = render(WeekBanner, { context });
    expect(await findByText("Tu semana")).toBeTruthy();
    expect((await findByText("Enviadas")).previousElementSibling?.textContent).toBe("3");
    expect(getByText("Recibidas").previousElementSibling?.textContent).toBe("4");
    expect(getByText("Respondidas").previousElementSibling?.textContent).toBe("2");
    expect(getByText(/Tardaste de media 12 min/)).toBeTruthy();
    expect(getByText(/María \(2\)/)).toBeTruthy();
  });

  test("descartarla la guarda para esta semana en las preferencias y la oculta", async () => {
    const { app, context, writeConfig } = await setup(MONDAY);
    const { findByRole, queryByText } = render(WeekBanner, { context });
    await fireEvent.click(await findByRole("button", { name: "Descartar" }));
    expect(writeConfig).toHaveBeenCalledWith(expect.objectContaining({ app: expect.objectContaining({ weekDismissed: "2026-W43" }) }));
    expect(app.weekDue).toBe(false);
    await Promise.resolve();
    expect(queryByText("Tu semana")).toBeNull();
  });

  test("otro día no sale ni la pide", async () => {
    const { context, myWeek } = await setup(TUESDAY);
    const { queryByText } = render(WeekBanner, { context });
    await Promise.resolve();
    expect(queryByText("Tu semana")).toBeNull();
    expect(myWeek).not.toHaveBeenCalled();
  });

  test("bajo demanda: la página la pide al abrirse; una semana vacía lo dice", async () => {
    const { context, myWeek } = await setup(TUESDAY, EMPTY);
    const { findByText } = render(WeekView, { context });
    expect(await findByText(/Semana tranquila/)).toBeTruthy();
    expect(myWeek).toHaveBeenCalledOnce();
  });
});
