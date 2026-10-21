import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ChannelMode } from "./args";
import { MARKETPLACE_NAME, PLUGIN_ID, PLUGIN_NAME, managedSettingsPaths, type Sys } from "./paths";

// Lo que dicen las managed settings de la organización sobre canales.
export type ChannelPolicy = {
  found: boolean; // hay alguna managed setting de canales en disco
  channelsEnabled: boolean | undefined;
  pluginAllowed: boolean; // devi@devi-local está en allowedChannelPlugins
};

type Settings = { channelsEnabled?: unknown; allowedChannelPlugins?: unknown };

const isDevi = (e: unknown) =>
  (typeof e === "object" && e !== null && (e as { plugin?: unknown }).plugin === PLUGIN_NAME &&
    (e as { marketplace?: unknown }).marketplace === MARKETPLACE_NAME) ||
  e === PLUGIN_ID;

// Fusiona en orden (los posteriores ganan), como Claude Code con managed-settings.d/.
export function policyFrom(sources: Settings[]): ChannelPolicy {
  let channelsEnabled: boolean | undefined;
  let allowed: unknown[] | undefined;
  let found = false;
  for (const s of sources) {
    if (typeof s.channelsEnabled === "boolean") {
      channelsEnabled = s.channelsEnabled;
      found = true;
    }
    if (Array.isArray(s.allowedChannelPlugins)) {
      allowed = s.allowedChannelPlugins;
      found = true;
    }
  }
  return { found, channelsEnabled, pluginAllowed: !!allowed?.some(isDevi) };
}

// auto → plugin solo si la organización permite explícitamente devi@devi-local; si no, flag de desarrollo.
export function decideChannelMode(requested: ChannelMode, policy: ChannelPolicy): "plugin" | "dev" {
  if (requested !== "auto") return requested;
  return policy.channelsEnabled === true && policy.pluginAllowed ? "plugin" : "dev";
}

export function channelArgs(mode: "plugin" | "dev"): string[] {
  return mode === "plugin"
    ? ["--channels", `plugin:${PLUGIN_ID}`]
    : ["--dangerously-load-development-channels", `plugin:${PLUGIN_ID}`];
}

async function readJson(path: string): Promise<Settings | null> {
  try {
    const data: unknown = JSON.parse(await readFile(path, "utf8"));
    if (typeof data !== "object" || data === null) return null;
    // remote-settings.json (caché de las settings del panel de claude.ai) no tiene formato documentado:
    // se aceptan las claves arriba del todo o dentro de "settings".
    const nested = (data as { settings?: unknown }).settings;
    return { ...(typeof nested === "object" && nested !== null ? (nested as Settings) : {}), ...(data as Settings) };
  } catch {
    return null;
  }
}

// Lee managed-settings.json, managed-settings.d/*.json y la caché ~/.claude/remote-settings.json.
// Las settings gestionadas desde el servidor que aún no estén en caché no se ven: por eso existe --channel plugin.
export async function readChannelPolicy(sys: Sys): Promise<ChannelPolicy> {
  const sources: Settings[] = [];
  for (const file of managedSettingsPaths(sys.platform)) {
    const main = await readJson(file);
    if (main) sources.push(main);
    const dropIns = join(dirname(file), "managed-settings.d");
    const names = await readdir(dropIns).catch(() => [] as string[]);
    for (const n of names.filter((n) => n.endsWith(".json")).sort()) {
      const s = await readJson(join(dropIns, n));
      if (s) sources.push(s);
    }
  }
  const remote = await readJson(join(sys.home, ".claude", "remote-settings.json"));
  if (remote) sources.push(remote);
  return policyFrom(sources);
}

// Bloque de managed settings que el Owner debe añadir (lo imprime `devi doctor`).
export const MANAGED_SETTINGS_SNIPPET = JSON.stringify(
  { channelsEnabled: true, allowedChannelPlugins: [{ marketplace: MARKETPLACE_NAME, plugin: PLUGIN_NAME }] },
  null,
  2,
);
