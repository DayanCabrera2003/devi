// Modo demo: pinta las pantallas con datos de ejemplo, sin Rust ni servidor. Solo en desarrollo
// (main.ts lo importa dentro de `if (import.meta.env.DEV)`).
import type { DeviRequest, UserEvent } from "@devi/protocol";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { mount } from "svelte";
import type { DeviApi } from "../lib/api";
import { DeviApp } from "../lib/app.svelte";
import type { ConversationsHttp, NativeFiles } from "../lib/conversations-api";
import { native } from "../lib/native";
import { applyTheme, isThemePref } from "../lib/theme";
import { AGENT_THREAD } from "../lib/thread-items";
import DemoRoot from "./DemoRoot.svelte";
import * as fx from "./fixtures";

function ipc(cmd: string): unknown {
  switch (cmd) {
    case "run_devi":
      return { code: 0, stdout: '{"installed":true,"files":[{"path":"~/.bashrc","installed":true},{"path":"~/.zshrc","installed":true}]}', stderr: "" };
    case "tailscale_self_login":
      return { login: "dayan@equipo.dev", dnsName: "pc-dayan.tail1234.ts.net" };
    case "tailscale_serve_configured":
    case "plugin:autostart|is_enabled":
      return true;
    case "server_status":
    case "start_server":
      return { running: true, pid: 4242, exitCode: null, log: ["[devi] servidor escuchando en 127.0.0.1:4747", "[devi] 4 personas, 5 roles"] };
    default:
      return null;
  }
}

function fakeApi(screen: string): DeviApi {
  const touch = (r: DeviRequest, status: DeviRequest["status"]) => ({ ...r, status });
  const find = (id: string) => [...fx.MARIA_HISTORY, fx.MARIA_PENDING, fx.LUCIA_ATTACK, fx.JORGE_ANSWERED].find((r) => r.id === id)!;
  const api = {
    me: async () => fx.ME,
    team: async () => fx.TEAM,
    health: async () => ({ ok: true, version: "0.3.0" }),
    memberSessions: async (id: string) => (id === fx.ME.member.id ? fx.SESSIONS : id === "m-maria" ? fx.SESSIONS.slice(0, 2) : fx.SESSIONS.slice(0, 1)),
    downloadFile: async (id: string) => fx.FILE_TEXT[id] ?? "",
    getSettings: async () => fx.SETTINGS,
    updateSettings: async (b: object) => ({ ...fx.SETTINGS, ...b }),
    audit: async () => ({ entries: fx.AUDIT, nextBefore: 3 }),
    forwardRequest: async (id: string) => touch(find(id), "forwarded"),
    acceptRequest: async (id: string) => touch(find(id), "accepted"),
    rejectRequest: async (id: string) => touch(find(id), "rejected"),
    acceptResponse: async (id: string) => touch(find(id), "closed"),
    forwardResponse: async (id: string) => touch(find(id), "closed"),
    resendRequest: async (id: string) => touch(find(id), "pending"),
    ignoreRequest: async (id: string) => touch(find(id), "closed"),
    authorizeDraft: async () => ({}),
    discardDraft: async () => ({}),
    subscribe: (onEvent: (e: UserEvent) => void, onStatus: (s: string) => void) => {
      onStatus("open");
      for (const ev of fx.openEvents(screen)) onEvent(ev);
      return () => {};
    },
  };
  return api as unknown as DeviApi;
}

function fakeConversations(screen: string): ConversationsHttp {
  return {
    conversations: async () => ({ items: fx.conversationItems(screen) }),
    conversation: async (memberId) => ({ requests: fx.threadFor(memberId, screen).slice().reverse(), nextBefore: memberId === "m-maria" ? 1 : undefined }),
    sendFromApp: async (meta) => ({
      id: `q-${Date.now()}`, fromMemberId: fx.ME.member.id, toMemberId: meta.to, fromSessionId: "", fromSessionName: "", origin: "app",
      message: meta.message, status: "pending", files: [], responseFiles: [], createdAt: Date.now(), sentAt: Date.now(), deadline: Date.now() + 3_600_000,
    }),
  };
}

const fakeFiles: NativeFiles = {
  pickFiles: async () => fx.PICKED,
  takeFiles: async () => [],
  discardFiles: async () => {},
  onFilesDropped: async () => () => {},
  onDragHover: async () => () => {},
};

// Pantalla → conversación abierta al empezar.
const OPEN: Record<string, string> = {
  thread: "m-maria",
  composer: "m-maria",
  drag: "m-maria",
  injection: "m-lucia",
  response: "m-jorge",
  forwarded: "m-pablo",
  agent: AGENT_THREAD,
  "empty-thread": "m-maria",
};

export async function mountDemo(target: HTMLElement, screen: string): Promise<void> {
  const params = new URLSearchParams(location.search);
  const theme = params.get("theme");
  document.documentElement.dataset.demo = fx.DEMO_MARKER;
  // El tema se fija antes del primer pintado, como hace main.ts con el guardado.
  applyTheme(isThemePref(theme) ? theme : "system");
  mockWindows("main");
  mockIPC((cmd) => ipc(cmd), { shouldMockEvents: true });

  const app = new DeviApp({
    native,
    makeApi: () => fakeApi(screen),
    notify: () => {},
    emitMascot: () => {},
    conversations: () => fakeConversations(screen),
    files: fakeFiles,
  });
  app.config = {
    serverUrl: "https://pc-dayan.tail1234.ts.net",
    app: { notifications: true, setupDone: true, serverAdminLogin: screen.startsWith("wizard") ? undefined : "dayan@equipo.dev", theme: isThemePref(theme) ? theme : "system" },
  };
  app.clock.start();
  app.phase = screen.startsWith("wizard") ? "wizard" : "app";
  if (app.phase === "app") await app.connect();
  await app.refreshConversations();

  if (screen === "blocked") app.conn.set({ status: "blocked", message: "El servidor de Devi rechazó el origen de esta app. Usa la app instalada." });
  if (screen === "unknown") app.conn.set({ status: "unknown_login", login: "nuevo@equipo.dev" });
  if (screen === "update") app.conn.set({ status: "update_required", minVersion: "0.4.0" });
  if (screen === "ajustes") app.goto("ajustes");
  if (screen.startsWith("admin")) app.goto("admin");
  const open = OPEN[screen];
  if (open) await app.openConversation(open);
  if (screen === "composer" || screen === "drag") {
    app.composer.text = "Te paso el manifiesto y las variables de staging para que lo despliegues tú.";
    app.composer.add(fakeFiles, fx.PICKED);
  }
  if (screen === "drag") app.drag.active = true;

  mount(DemoRoot, { target, props: { app, screen } });
}

