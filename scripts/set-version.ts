// Fija la versión del producto (X.Y.Z) en todos los sitios donde vive: package.json de la raíz,
// de la app de escritorio y de los paquetes cli/server/client, Cargo.toml (+ Cargo.lock) de la app
// y los manifiestos del plugin en plugin/. NO toca packages/protocol ni API_VERSION: la versión
// del protocolo es independiente.
// Uso: bun scripts/set-version.ts <X.Y.Z>   (o `bun run version:set <X.Y.Z>`)
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const APP_CRATE = "devi-desktop";

export function isVersion(v: string): boolean {
  return /^\d+\.\d+\.\d+$/.test(v);
}

// "top": solo la primera clave "version" con sangría de primer nivel (2 espacios).
// "all": todas las claves "version" (manifiesto del marketplace, con la versión del plugin dentro).
export function setJsonVersions(text: string, version: string, mode: "top" | "all"): string {
  const re = mode === "top" ? /^( {2}"version":\s*)"[^"]*"/m : /("version":\s*)"[^"]*"/g;
  if (!re.test(text)) throw new Error("sin clave \"version\"");
  re.lastIndex = 0;
  return text.replace(re, `$1"${version}"`);
}

// Cambia `version = "..."` solo dentro de la sección [package].
export function setCargoTomlVersion(text: string, version: string): string {
  const re = /(^\[package\]\s*\n(?:(?!\[)[^\n]*\n)*?version\s*=\s*)"[^"]*"/m;
  if (!re.test(text)) throw new Error("Cargo.toml sin version en [package]");
  return text.replace(re, `$1"${version}"`);
}

// Cambia la versión de la entrada [[package]] de `crate` en Cargo.lock (si existe).
export function setCargoLockVersion(text: string, crate: string, version: string): string {
  const name = crate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(\\[\\[package\\]\\]\\nname = "${name}"\\nversion = )"[^"]*"`);
  return text.replace(re, `$1"${version}"`);
}

// Cambia la versión de los workspaces `names` en bun.lock (bun install no la actualiza solo).
export function setBunLockVersions(text: string, names: string[], version: string): string {
  let out = text;
  for (const n of names) {
    const name = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`("name": "${name}",\\n\\s*"version": )"[^"]*"`), `$1"${version}"`);
  }
  return out;
}

const WORKSPACES = ["@devi/desktop", "@devi/cli", "@devi/server", "@devi/client"];

type VersionFile = { path: string; rewrite: (text: string, version: string) => string; optional?: boolean };

export const VERSION_FILES: VersionFile[] = [
  ...["package.json", "apps/desktop/package.json", "packages/cli/package.json", "packages/server/package.json", "packages/client/package.json"].map(
    (path) => ({ path, rewrite: (t: string, v: string) => setJsonVersions(t, v, "top") }),
  ),
  { path: "apps/desktop/src-tauri/Cargo.toml", rewrite: setCargoTomlVersion },
  { path: "apps/desktop/src-tauri/Cargo.lock", rewrite: (t, v) => setCargoLockVersion(t, APP_CRATE, v), optional: true },
  { path: "bun.lock", rewrite: (t, v) => setBunLockVersions(t, WORKSPACES, v), optional: true },
  // Copia de referencia del plugin (la genera scripts/gen-plugin.ts con CLI_VERSION).
  { path: "plugin/devi/.claude-plugin/plugin.json", rewrite: (t, v) => setJsonVersions(t, v, "top"), optional: true },
  { path: "plugin/.claude-plugin/marketplace.json", rewrite: (t, v) => setJsonVersions(t, v, "all"), optional: true },
];

if (import.meta.main) {
  const version = process.argv[2] ?? "";
  if (!isVersion(version)) {
    console.error("uso: bun scripts/set-version.ts <X.Y.Z>");
    process.exit(1);
  }
  const root = join(import.meta.dir, "..");
  for (const f of VERSION_FILES) {
    const path = join(root, f.path);
    if (!existsSync(path)) {
      if (f.optional) continue;
      throw new Error(`no existe ${f.path}`);
    }
    const before = readFileSync(path, "utf8");
    const after = f.rewrite(before, version);
    if (after !== before) writeFileSync(path, after);
    console.log(`${after !== before ? "✓" : "="} ${f.path}`);
  }
  console.log(`Versión ${version}. Regenera lo derivado: bun scripts/gen-plugin.ts`);
}
