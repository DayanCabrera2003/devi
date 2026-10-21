// DeviApp con dependencias falsas para los tests de componentes (*.vitest.ts). No se importa desde la app.
import { vi } from "vitest";
import type { DeviApi } from "./api";
import { DeviApp } from "./app.svelte";
import { appContext } from "./context";
import type { Native } from "./native";
import { ME, TEAM } from "./test-fixtures";

export function fakeApp(api: Record<string, unknown> = {}) {
  const fullApi = {
    me: vi.fn(async () => ME),
    team: vi.fn(async () => TEAM),
    memberSessions: vi.fn(async () => []),
    downloadFile: vi.fn(async () => ""),
    subscribe: vi.fn(() => () => {}),
    ...api,
  };
  const app = new DeviApp({
    native: {} as Native,
    makeApi: () => fullApi as unknown as DeviApi,
    notify: vi.fn(),
    emitMascot: vi.fn(),
  });
  app.config = { serverUrl: "https://pc.t.ts.net", app: { notifications: true, setupDone: true } };
  app.team.me = ME;
  app.team.team = TEAM;
  return { app, api: fullApi, context: appContext(app) };
}
