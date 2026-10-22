// Wrappers tipados de los comandos Rust (src-tauri). Tauri convierte los nombres de los
// argumentos de camelCase (JS) a snake_case (Rust).
import { invoke } from "@tauri-apps/api/core";
import type { ThemePref } from "./theme";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type AppPrefs = {
  notifications: boolean;
  setupDone: boolean;
  serverAdminLogin?: string; // presente = este equipo es el servidor
  theme?: ThemePref; // sin valor = sigue al sistema
  showMascot?: boolean; // burbuja flotante con Devi; sin valor (instalaciones anteriores) = apagada
  weekDismissed?: string; // semana ISO ("2026-W43") en la que se descartó la tarjeta «Tu semana»
};

export const DEFAULT_PREFS: AppPrefs = { notifications: true, setupDone: false, showMascot: false };

// Misma forma que <config del SO>/devi/config.json del CLI, más receivedDir y app.
export type ClientConfig = {
  serverUrl: string;
  devUser?: string;
  receivedDir?: string;
  app?: AppPrefs;
};

export type TailscaleSelf = { login: string; dnsName: string };
export type DeviOutput = { code: number | null; stdout: string; stderr: string };
// available: false si no se pudo crear el icono de la bandeja (p. ej. GNOME sin AppIndicator).
export type TrayStatus = { available: boolean; paused: boolean };
export type ServerStatus = { running: boolean; pid: number | null; exitCode: number | null; log: string[] };

// Archivos para adjuntar al enviar desde la app. Rust los lee y valida (texto UTF-8 sin NUL, ≤ 1 MB) y los
// guarda en memoria con un token: el webview nunca ve ni elige rutas. Con takeFiles se recogen (y se borran)
// al enviar; Rust guarda como mucho 20 y olvida los más antiguos.
export type PickedFile = { token: string; name: string; size: number; preview: string }; // preview: primeros 4 KB
export type PickResult = { files: PickedFile[]; rejected: { name: string; reason: string }[] };
export type DragHover = { active: boolean };

export const FILES_DROPPED_EVENT = "devi://files-dropped";
export const DRAG_HOVER_EVENT = "devi://drag-hover";

export const native = {
  readConfig: () => invoke<ClientConfig | null>("read_client_config"),
  // Rust rechaza cualquier cambio de receivedDir por esta vía.
  writeConfig: (config: ClientConfig) => invoke<void>("write_client_config", { config }),
  // Abre el diálogo de carpeta en Rust; null si se cancela.
  chooseReceivedDir: () => invoke<ClientConfig | null>("choose_received_dir"),
  resetReceivedDir: () => invoke<ClientConfig>("reset_received_dir"),
  // kind "request" → <recibidos>/<id>/ ; "response" → <recibidos>/<id>/respuesta/
  saveReceivedFiles: (requestId: string, kind: "request" | "response", files: { name: string; content: string }[]) =>
    invoke<string[]>("save_received_files", { requestId, kind, files }),
  // Diálogo nativo de varios archivos (en Rust). Cancelar → { files: [], rejected: [] }.
  pickFiles: () => invoke<PickResult>("pick_files"),
  takeFiles: (tokens: string[]) => invoke<{ name: string; content: string }[]>("take_files", { tokens }),
  discardFiles: (tokens: string[]) => invoke<void>("discard_files", { tokens }),
  // Archivos soltados sobre la ventana principal, ya validados por Rust.
  onFilesDropped: (cb: (result: PickResult) => void): Promise<UnlistenFn> => listen<PickResult>(FILES_DROPPED_EVENT, (e) => cb(e.payload)),
  // Algo se arrastra sobre la ventana (active: true) o salió / se soltó (false).
  onDragHover: (cb: (hover: DragHover) => void): Promise<UnlistenFn> => listen<DragHover>(DRAG_HOVER_EVENT, (e) => cb(e.payload)),
  saveDbExport: (bytes: Uint8Array) => invoke<string>("save_db_export", bytes),
  runDevi: (args: string[]) => invoke<DeviOutput>("run_devi", { args }),
  tailscaleSelf: () => invoke<TailscaleSelf>("tailscale_self_login"),
  tailscaleServeConfigured: (port = 4747) => invoke<boolean>("tailscale_serve_configured", { port }),
  startServer: (adminLogin: string) => invoke<ServerStatus>("start_server", { adminLogin }),
  stopServer: () => invoke<ServerStatus>("stop_server"),
  serverStatus: () => invoke<ServerStatus>("server_status"),
  showMainWindow: () => invoke<void>("show_main_window"),
  // Crea la ventana mascota si hace falta y la muestra u oculta (la preferencia la guarda la UI).
  setMascotVisible: (visible: boolean) => invoke<void>("set_mascot_visible", { visible }),
  // Cuántas cosas me esperan: punto en el icono, "Ver avisos (N)" y tooltip del tray.
  setTrayAttention: (pending: number) => invoke<void>("set_tray_attention", { pending }),
  trayStatus: () => invoke<TrayStatus>("tray_status"),
  setPaused: (paused: boolean) => invoke<void>("set_paused", { paused }),
  // Mata el servidor sidecar (si lo hay) y cierra Devi: la salida sin icono de bandeja.
  quitApp: () => invoke<void>("quit_app"),
};

export type Native = typeof native;

export function prefsOf(config: ClientConfig | null | undefined): AppPrefs {
  return { ...DEFAULT_PREFS, ...(config?.app ?? {}) };
}
