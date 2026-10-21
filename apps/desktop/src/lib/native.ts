// Wrappers tipados de los comandos Rust (src-tauri). Tauri convierte los nombres de los
// argumentos de camelCase (JS) a snake_case (Rust).
import { invoke } from "@tauri-apps/api/core";

export type AppPrefs = {
  notifications: boolean;
  setupDone: boolean;
  serverAdminLogin?: string; // presente = este equipo es el servidor
};

export const DEFAULT_PREFS: AppPrefs = { notifications: true, setupDone: false };

// Misma forma que <config del SO>/devi/config.json del CLI, más receivedDir y app.
export type ClientConfig = {
  serverUrl: string;
  devUser?: string;
  receivedDir?: string;
  app?: AppPrefs;
};

export type TailscaleSelf = { login: string; dnsName: string };
export type DeviOutput = { code: number | null; stdout: string; stderr: string };
export type ServerStatus = { running: boolean; pid: number | null; exitCode: number | null; log: string[] };

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
  saveDbExport: (bytes: Uint8Array) => invoke<string>("save_db_export", bytes),
  runDevi: (args: string[]) => invoke<DeviOutput>("run_devi", { args }),
  tailscaleSelf: () => invoke<TailscaleSelf>("tailscale_self_login"),
  tailscaleServeConfigured: (port = 4747) => invoke<boolean>("tailscale_serve_configured", { port }),
  startServer: (adminLogin: string) => invoke<ServerStatus>("start_server", { adminLogin }),
  stopServer: () => invoke<ServerStatus>("stop_server"),
  serverStatus: () => invoke<ServerStatus>("server_status"),
  showMainWindow: () => invoke<void>("show_main_window"),
  setPaused: (paused: boolean) => invoke<void>("set_paused", { paused }),
};

export type Native = typeof native;

export function prefsOf(config: ClientConfig | null | undefined): AppPrefs {
  return { ...DEFAULT_PREFS, ...(config?.app ?? {}) };
}
