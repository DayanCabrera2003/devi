import { homedir } from "node:os";
import { posix, win32 } from "node:path";

type Env = Record<string, string | undefined>;
export type Sys = { platform: NodeJS.Platform; env: Env; home: string };

export const MARKETPLACE_NAME = "devi-local";
export const PLUGIN_NAME = "devi";
export const PLUGIN_ID = `${PLUGIN_NAME}@${MARKETPLACE_NAME}`;

// Variable XDG_* utilizable: como el crate dirs de Rust, se ignora si está vacía o no es absoluta.
function xdgDir(value: string | undefined): string | undefined {
  return value && posix.isAbsolute(value) ? value : undefined;
}

// Directorio de configuración del SO (el mismo que dirs::config_dir() en Rust/Tauri).
export function osConfigDir({ platform, env, home }: Sys): string {
  if (platform === "win32") return env.APPDATA ?? win32.join(home, "AppData", "Roaming");
  if (platform === "darwin") return posix.join(home, "Library", "Application Support");
  return xdgDir(env.XDG_CONFIG_HOME) ?? posix.join(home, ".config");
}

// Configuración del cliente: <config del SO>/devi/config.json. DEVI_CONFIG la sustituye (tests, varias cuentas).
export function clientConfigPath(sys: Sys): string {
  if (sys.env.DEVI_CONFIG) return sys.env.DEVI_CONFIG;
  const join = sys.platform === "win32" ? win32.join : posix.join;
  return join(osConfigDir(sys), "devi", "config.json");
}

// Raíz de datos locales del cliente: aquí viven el binario estable y el marketplace del plugin.
export function appDataDir({ platform, env, home }: Sys): string {
  if (platform === "win32") return win32.join(env.LOCALAPPDATA ?? win32.join(home, "AppData", "Local"), "Devi");
  if (platform === "darwin") return posix.join(home, "Library", "Application Support", "Devi");
  return posix.join(xdgDir(env.XDG_DATA_HOME) ?? posix.join(home, ".local", "share"), "devi");
}

export function binaryName(platform: NodeJS.Platform): string {
  return platform === "win32" ? "devi.exe" : "devi";
}

export function stableBinDir(sys: Sys): string {
  return (sys.platform === "win32" ? win32.join : posix.join)(appDataDir(sys), "bin");
}

export function stableBinPath(sys: Sys): string {
  return (sys.platform === "win32" ? win32.join : posix.join)(stableBinDir(sys), binaryName(sys.platform));
}

export function marketplaceDir(sys: Sys): string {
  return (sys.platform === "win32" ? win32.join : posix.join)(appDataDir(sys), "marketplace");
}

export function defaultReceivedDir(sys: Sys): string {
  return (sys.platform === "win32" ? win32.join : posix.join)(sys.home, "Devi", "recibidos");
}

// Ficheros de managed settings de Claude Code (más su carpeta managed-settings.d/).
export function managedSettingsPaths(platform: NodeJS.Platform): string[] {
  if (platform === "win32") return ["C:\\Program Files\\ClaudeCode\\managed-settings.json"];
  if (platform === "darwin") return ["/Library/Application Support/ClaudeCode/managed-settings.json"];
  return ["/etc/claude-code/managed-settings.json"];
}

export function currentSys(): Sys {
  return { platform: process.platform, env: process.env, home: homedir() };
}
