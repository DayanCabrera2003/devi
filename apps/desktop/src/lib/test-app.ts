// DeviApp con dependencias falsas para los tests de componentes (*.vitest.ts). No se importa desde la app.
import { vi } from "vitest";
import type { DeviApi } from "./api";
import { DeviApp } from "./app.svelte";
import { appContext } from "./context";
import type { ConversationsHttp, NativeFiles } from "./conversations-api";
import type { Native } from "./native";
import { ME, TEAM } from "./test-fixtures";

// Conecta (team.refresh + subscribe con la API falsa) para que las acciones tengan API.
// native: solo los comandos Rust que use el componente bajo prueba.
export async function fakeApp(
  api: Record<string, unknown> = {},
  nativeOverrides: Partial<Record<keyof Native, unknown>> = {},
  conversationsOverrides: Partial<Record<keyof ConversationsHttp, unknown>> = {},
  filesOverrides: Partial<Record<keyof NativeFiles, unknown>> = {},
) {
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
    // Ajustes lee la preferencia de avisos en las sesiones al montarse.
    myPrefs: vi.fn(async () => ({ sessionNotices: true })),
    myClaims: vi.fn(async () => []),
    createClaim: vi.fn(async () => ({ code: "K7Q4MX", target: { type: "request", id: "x" }, expiresAt: Date.now() + 600_000, status: "open" })),
    cancelClaim: vi.fn(async () => ({ ok: true })),
    ...api,
  };
  const conversations = {
    conversations: vi.fn(async () => ({ items: [] })),
    conversation: vi.fn(async () => ({ requests: [] })),
    sendFromApp: vi.fn(async () => ({})),
    chat: vi.fn(async () => ({ messages: [] })),
    sendChat: vi.fn(async () => ({})),
    ...conversationsOverrides,
  };
  const files = {
    pickFiles: vi.fn(async () => ({ files: [], rejected: [] })),
    takeFiles: vi.fn(async () => []),
    discardFiles: vi.fn(async () => {}),
    onFilesDropped: vi.fn(async () => () => {}),
    onDragHover: vi.fn(async () => () => {}),
    ...filesOverrides,
  };
  const app = new DeviApp({
    native: native as unknown as Native,
    makeApi: () => fullApi as unknown as DeviApi,
    notify: vi.fn(),
    emitMascot: vi.fn(),
    conversations: () => conversations as unknown as ConversationsHttp,
    files: files as unknown as NativeFiles,
  });
  app.config = { serverUrl: "https://pc.t.ts.net", app: { notifications: true, setupDone: true } };
  await app.connect();
  return { app, api: fullApi, native, conversations, files, context: appContext(app) };
}
