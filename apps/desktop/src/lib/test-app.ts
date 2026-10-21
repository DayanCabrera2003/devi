// DeviApp con dependencias falsas para los tests de componentes (*.vitest.ts). No se importa desde la app.
import { vi } from "vitest";
import type { DeviApi } from "./api";
import { DeviApp } from "./app.svelte";
import { appContext } from "./context";
import type { Native } from "./native";
import { ME, TEAM } from "./test-fixtures";

// Conecta (team.refresh + subscribe con la API falsa) para que las acciones tengan API.
// native: solo los comandos Rust que use el componente bajo prueba.
export async function fakeApp(api: Record<string, unknown> = {}, nativeOverrides: Partial<Record<keyof Native, unknown>> = {}) {
  // Ajustes pregunta `devi shell-alias status --json` al montarse.
  const native = {
    runDevi: vi.fn(async () => ({ code: 0, stdout: '{"installed":false,"files":[]}', stderr: "" })),
    ...nativeOverrides,
  };
  const fullApi = {
    me: vi.fn(async () => ME),
    team: vi.fn(async () => TEAM),
    memberSessions: vi.fn(async () => []),
    downloadFile: vi.fn(async () => ""),
    subscribe: vi.fn(() => () => {}),
    ...api,
  };
  const app = new DeviApp({
    native: native as unknown as Native,
    makeApi: () => fullApi as unknown as DeviApi,
    notify: vi.fn(),
    emitMascot: vi.fn(),
  });
  app.config = { serverUrl: "https://pc.t.ts.net", app: { notifications: true, setupDone: true } };
  await app.connect();
  return { app, api: fullApi, native, context: appContext(app) };
}
