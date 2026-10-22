import { fireEvent, render } from "@testing-library/svelte";
import { describe, expect, test, vi } from "vitest";
import type { DeviApp } from "../lib/app.svelte";
import { fakeApp } from "../lib/test-app";
import { ME, TEAM } from "../lib/test-fixtures";
import Shell from "./Shell.svelte";

// Shell crea su DeviApp con createApp(): aquí devuelve la de prueba, ya conectada.
const holder = vi.hoisted(() => ({ app: null as unknown as DeviApp }));
vi.mock("../lib/boot", () => ({ createApp: () => holder.app }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

async function mount(me = ME) {
  const { app } = await fakeApp({ me: vi.fn(async () => me), team: vi.fn(async () => TEAM) });
  app.boot = vi.fn(async () => {});
  app.phase = "app";
  holder.app = app;
  return { app, ...render(Shell) };
}

const NOT_ADMIN = { ...ME, perms: ["requests.send" as const] };

describe("Shell", () => {
  test("con team.admin aparece la pestaña Admin y la abre", async () => {
    const { getByRole, findByRole } = await mount();
    await fireEvent.click(getByRole("button", { name: "Admin" }));
    expect(await findByRole("button", { name: "Invitar por login" })).toBeTruthy();
  });

  test("sin team.admin no hay pestaña Admin", async () => {
    const { queryByRole } = await mount(NOT_ADMIN);
    expect(queryByRole("button", { name: "Admin" })).toBeNull();
  });

  test("aunque la vista sea admin, sin el permiso no se monta", async () => {
    const { app, queryByRole } = await mount(NOT_ADMIN);
    app.goto("admin");
    await Promise.resolve();
    expect(queryByRole("button", { name: "Invitar por login" })).toBeNull();
    expect(queryByRole("button", { name: "Personas" })).toBeNull();
  });

  test("«Tu semana» se abre bajo demanda desde la barra lateral", async () => {
    const myWeek = vi.fn(async () => ({ from: 0, to: 1, sent: 1, received: 0, answered: 0, avgResponseMs: null, topHelped: [] }));
    const { app } = await fakeApp({ me: vi.fn(async () => ME), team: vi.fn(async () => TEAM), myWeek });
    app.boot = vi.fn(async () => {});
    app.phase = "app";
    holder.app = app;
    const { getByRole, findByRole } = render(Shell);
    await fireEvent.click(getByRole("button", { name: "Tu semana" }));
    expect(await findByRole("heading", { name: "Tu semana" })).toBeTruthy();
    expect(myWeek).toHaveBeenCalledOnce();
  });
});

