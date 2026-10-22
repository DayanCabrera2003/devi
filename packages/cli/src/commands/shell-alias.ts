// `devi shell-alias install|remove|status`: define una función `claude` en los perfiles de shell
// para que escribir `claude` equivalga a `devi claude -- ...`. Todo lo que escribe Devi va entre
// las marcas BLOCK_BEGIN y BLOCK_END; lo de fuera nunca se toca.
import { existsSync } from "node:fs";
import { chmod, copyFile, mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, posix, win32 } from "node:path";
import { stableBinPath, type Sys } from "../paths";
import { which as defaultWhich } from "../proc";

export const BLOCK_BEGIN = "# >>> devi >>>";
export const BLOCK_END = "# <<< devi <<<";

export type ShellKind = "sh" | "fish" | "powershell";
export type AliasTarget = { path: string; kind: ShellKind };
export type AliasDeps = { which?: (cmd: string) => string | null; deviPath?: string };
export type AliasAction = "installed" | "updated" | "removed" | "absent" | "skipped" | "error";
export type AliasFileResult = { path: string; action: AliasAction; detail?: string };
export type AliasStatus = { installed: boolean; files: { path: string; installed: boolean }[] };

// ---- bloques ---------------------------------------------------------------------------

const shQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
const fishQuote = (s: string) => `'${s.replace(/[\\']/g, (c) => `\\${c}`)}'`;
const psQuote = (s: string) => `'${s.replace(/'/g, "''")}'`;

// Solo ASCII en los comentarios: Windows PowerShell 5.1 lee los perfiles sin BOM como ANSI.
const HEADER = [
  "# Devi: escribir `claude` abre Claude Code con el canal de Devi (igual que `devi claude -- ...`).",
  "# Lo gestiona `devi shell-alias install|remove`; no edites nada entre estas marcas.",
];

export function renderBlock(kind: ShellKind, devi: string): string {
  let body: string[];
  if (kind === "sh") {
    // `function claude {` y no `claude() {`: si hay un alias `claude`, zsh no falla al definir la función.
    const d = shQuote(devi);
    body = [
      "# Para usar el claude original: `command claude ...` o `DEVI_NO_ALIAS=1 claude ...`.",
      "# Con DEVI_NO_ALIAS=1 al cargar el rc (lo usa devi para localizar claude) la funcion no se define.",
      'if [ "${DEVI_NO_ALIAS:-}" != 1 ]; then',
      "function claude {",
      `  if [ "\${DEVI_NO_ALIAS:-}" = 1 ] || [ ! -x ${d} ]; then command claude "$@"; else ${d} claude -- "$@"; fi`,
      "}",
      "fi",
    ];
  } else if (kind === "fish") {
    const d = fishQuote(devi);
    body = [
      "# Para usar el claude original: `command claude ...` o `DEVI_NO_ALIAS=1 claude ...`.",
      "# Con DEVI_NO_ALIAS=1 al cargar la config (lo usa devi para localizar claude) la funcion no se define.",
      'if test "$DEVI_NO_ALIAS" != 1',
      "function claude",
      `    if test "$DEVI_NO_ALIAS" = 1; or not test -x ${d}`,
      "        command claude $argv",
      "    else",
      `        ${d} claude -- $argv`,
      "    end",
      "end",
      "end",
    ];
  } else {
    // '--' entre comillas: Windows PowerShell se come un -- sin comillas al llamar a un ejecutable.
    const d = psQuote(devi);
    body = [
      "# Para usar el claude original: `claude.exe ...` (o claude.cmd) o `$env:DEVI_NO_ALIAS = '1'`.",
      "if ($env:DEVI_NO_ALIAS -ne '1') {",
      "function claude {",
      `  if ($env:DEVI_NO_ALIAS -eq '1' -or -not (Test-Path -LiteralPath ${d})) {`,
      "    $real = Get-Command -Name claude -CommandType Application, ExternalScript -ErrorAction SilentlyContinue | Select-Object -First 1",
      "    if ($real) { & $real.Source @args } else { Write-Error 'No encuentro claude en el PATH' }",
      "  } else {",
      `    & ${d} claude '--' @args`,
      "  }",
      "}",
      "}",
    ];
  }
  return [BLOCK_BEGIN, ...HEADER, ...body, BLOCK_END, ""].join("\n");
}

// Posición del bloque (inicio de la línea BEGIN y fin tras la línea END con su salto), o null.
function findBlock(content: string): { start: number; end: number } | null {
  const lines = content.split("\n");
  const isLine = (l: string, mark: string) => l.replace(/\r$/, "").trim() === mark;
  const b = lines.findIndex((l) => isLine(l, BLOCK_BEGIN));
  const e = lines.findIndex((l) => isLine(l, BLOCK_END));
  if (b === -1 && e === -1) return null;
  if (b === -1 || e === -1 || e < b) throw new Error(`marcas de Devi incompletas o desordenadas (${BLOCK_BEGIN} … ${BLOCK_END}); revísalas a mano`);
  const offset = (i: number) => lines.slice(0, i).reduce((n, l) => n + l.length + 1, 0);
  return { start: offset(b), end: Math.min(offset(e + 1), content.length) };
}

// Añade el bloque al final o reemplaza el que ya hay. Usa CRLF si el fichero ya lo usa.
export function upsertBlock(content: string, block: string): string {
  const eolBlock = content.includes("\r\n") ? block.replace(/\n/g, "\r\n") : block;
  const found = findBlock(content);
  if (found) return content.slice(0, found.start) + eolBlock + content.slice(found.end);
  if (content === "") return eolBlock;
  const sep = content.endsWith("\n") ? "" : content.includes("\r\n") ? "\r\n" : "\n";
  return content + sep + eolBlock;
}

// El contenido sin el bloque, o null si no había bloque.
export function stripBlock(content: string): string | null {
  const found = findBlock(content);
  if (!found) return null;
  return content.slice(0, found.start) + content.slice(found.end);
}

const hasBlock = (content: string) => {
  try {
    return findBlock(content) !== null;
  } catch {
    return true; // hay marcas (aunque rotas): cuenta como instalado
  }
};

// ---- qué ficheros ----------------------------------------------------------------------

const absOr = (v: string | undefined, fallback: string) => (v && posix.isAbsolute(v) ? v : fallback);

function unixFiles(sys: Sys) {
  const j = posix.join;
  const config = absOr(sys.env.XDG_CONFIG_HOME, j(sys.home, ".config"));
  return {
    zshrc: j(absOr(sys.env.ZDOTDIR, sys.home), ".zshrc"),
    bashrc: j(sys.home, ".bashrc"),
    bashProfile: j(sys.home, ".bash_profile"),
    fishDir: j(config, "fish"),
    fish: j(config, "fish", "functions", "claude.fish"),
    pwsh: j(config, "powershell", "Microsoft.PowerShell_profile.ps1"),
  };
}

// Perfiles de PowerShell 7 y Windows PowerShell 5.1 en %USERPROFILE%\Documents.
// Si OneDrive redirige Documentos, PowerShell usa otra carpeta: no está soportado (ver docs).
function windowsProfiles(sys: Sys): string[] {
  const docs = win32.join(sys.env.USERPROFILE || sys.home, "Documents");
  return ["PowerShell", "WindowsPowerShell"].map((d) => win32.join(docs, d, "Microsoft.PowerShell_profile.ps1"));
}

// Dónde instala `install`: rc de zsh/bash que existen (o el del $SHELL si no hay ninguno), fish si
// existe su carpeta de configuración, y PowerShell (siempre en Windows; en macOS/Linux si hay pwsh).
export function aliasTargets(sys: Sys, deps: AliasDeps = {}): AliasTarget[] {
  if (sys.platform === "win32") return windowsProfiles(sys).map((path) => ({ path, kind: "powershell" }));
  const which = deps.which ?? defaultWhich;
  const f = unixFiles(sys);
  const rcs = [f.zshrc, f.bashrc, ...(sys.platform === "darwin" ? [f.bashProfile] : [])];
  const out: AliasTarget[] = rcs.filter((p) => existsSync(p)).map((path) => ({ path, kind: "sh" }));
  const fishExists = existsSync(f.fishDir);
  if (out.length === 0) {
    const shell = basename(sys.env.SHELL ?? "");
    if (shell === "zsh") out.push({ path: f.zshrc, kind: "sh" });
    else if (shell === "bash") out.push({ path: sys.platform === "darwin" ? f.bashProfile : f.bashrc, kind: "sh" });
    else if (shell === "fish" && !fishExists) out.push({ path: f.fish, kind: "fish" });
  }
  if (fishExists) out.push({ path: f.fish, kind: "fish" });
  if (which("pwsh")) out.push({ path: f.pwsh, kind: "powershell" });
  return out;
}

// Todos los ficheros donde podría haber un bloque de Devi (para remove/status).
function knownFiles(sys: Sys): AliasTarget[] {
  if (sys.platform === "win32") return windowsProfiles(sys).map((path) => ({ path, kind: "powershell" }));
  const f = unixFiles(sys);
  return [
    { path: f.zshrc, kind: "sh" },
    { path: f.bashrc, kind: "sh" },
    { path: f.bashProfile, kind: "sh" },
    { path: f.fish, kind: "fish" },
    { path: f.pwsh, kind: "powershell" },
  ];
}

// ---- escritura -------------------------------------------------------------------------

async function readIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

// Escribe en un temporal junto al fichero y renombra. Si es un enlace (dotfiles), escribe su destino.
// Antes de la primera modificación de un fichero que ya existía, deja una copia en <fichero>.devi-backup.
async function writeAtomic(path: string, content: string, existed: boolean): Promise<void> {
  const real = existed ? await realpath(path) : path;
  let mode: number | undefined;
  if (existed) {
    mode = (await stat(real)).mode & 0o7777;
    const backup = `${path}.devi-backup`;
    if (!existsSync(backup)) await copyFile(real, backup);
  } else {
    await mkdir(dirname(real), { recursive: true });
  }
  const tmp = `${real}.devi-tmp-${process.pid}`;
  try {
    await writeFile(tmp, content, "utf8");
    if (mode !== undefined) await chmod(tmp, mode);
    await rename(tmp, real);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
}

export async function installAlias(sys: Sys, deps: AliasDeps = {}): Promise<AliasFileResult[]> {
  const devi = deps.deviPath ?? stableBinPath(sys);
  const results: AliasFileResult[] = [];
  for (const t of aliasTargets(sys, deps)) {
    try {
      const block = renderBlock(t.kind, devi);
      const current = await readIfExists(t.path);
      if (t.kind === "fish") {
        // Fichero entero de Devi: si ya hay una función claude del usuario, no se pisa.
        if (current !== null && !current.includes(BLOCK_BEGIN)) {
          results.push({ path: t.path, action: "skipped", detail: "ya existe una función claude que no es de Devi" });
          continue;
        }
        if (current !== block) await writeAtomic(t.path, block, false);
        results.push({ path: t.path, action: current === null ? "installed" : "updated" });
        continue;
      }
      const action: AliasAction = current !== null && findBlock(current) ? "updated" : "installed";
      const next = upsertBlock(current ?? "", block);
      if (next !== current) await writeAtomic(t.path, next, current !== null);
      results.push({ path: t.path, action });
    } catch (e) {
      results.push({ path: t.path, action: "error", detail: (e as Error).message });
    }
  }
  return results;
}

export async function removeAlias(sys: Sys, _deps: AliasDeps = {}): Promise<AliasFileResult[]> {
  const results: AliasFileResult[] = [];
  for (const t of knownFiles(sys)) {
    try {
      const current = await readIfExists(t.path);
      if (current === null) continue;
      if (t.kind === "fish") {
        if (current.includes(BLOCK_BEGIN)) {
          await rm(t.path, { force: true });
          results.push({ path: t.path, action: "removed" });
        } else results.push({ path: t.path, action: "absent" });
        continue;
      }
      const next = stripBlock(current);
      if (next === null) results.push({ path: t.path, action: "absent" });
      else {
        await writeAtomic(t.path, next, true);
        results.push({ path: t.path, action: "removed" });
      }
    } catch (e) {
      results.push({ path: t.path, action: "error", detail: (e as Error).message });
    }
  }
  return results;
}

// Ficheros de instalación más cualquier otro conocido que ya tenga el bloque.
export async function aliasStatus(sys: Sys, deps: AliasDeps = {}): Promise<AliasStatus> {
  const targets = new Set(aliasTargets(sys, deps).map((t) => t.path));
  const files: AliasStatus["files"] = [];
  for (const path of new Set([...targets, ...knownFiles(sys).map((t) => t.path)])) {
    const content = await readIfExists(path).catch(() => null);
    const installed = content !== null && hasBlock(content);
    if (installed || targets.has(path)) files.push({ path, installed });
  }
  return { installed: files.some((f) => f.installed), files };
}

// ---- comando ---------------------------------------------------------------------------

export type ShellAliasAction = "install" | "remove" | "status";

const ACTION_TEXT: Record<AliasAction, string> = {
  installed: "instalado",
  updated: "actualizado",
  removed: "quitado",
  absent: "no estaba",
  skipped: "omitido",
  error: "error",
};

export async function runShellAlias(
  opts: { action: ShellAliasAction; json: boolean },
  sys: Sys,
  deps: AliasDeps = {},
): Promise<number> {
  if (opts.action === "status") {
    const s = await aliasStatus(sys, deps);
    if (opts.json) console.log(JSON.stringify(s));
    else {
      console.log(s.installed ? "La función `claude` de Devi está instalada." : "La función `claude` de Devi no está instalada.");
      for (const f of s.files) console.log(`${f.installed ? "✓" : "·"} ${f.path}`);
    }
    return 0;
  }

  let results: AliasFileResult[];
  let error: string | undefined;
  if (opts.action === "install") {
    const devi = deps.deviPath ?? stableBinPath(sys);
    if (!existsSync(devi)) {
      error = `devi no está instalado en ${devi}; ejecuta antes \`devi install-integration\``;
      results = [];
    } else {
      results = await installAlias(sys, { ...deps, deviPath: devi });
      if (results.length === 0) error = "no encontré ningún shell compatible (zsh, bash, fish o PowerShell)";
    }
  } else {
    results = await removeAlias(sys, deps);
  }
  const failed = results.find((r) => r.action === "error");
  if (!error && failed) error = `${failed.path}: ${failed.detail}`;
  const ok = !error;

  if (opts.json) console.log(JSON.stringify({ ok, files: results, ...(error ? { error } : {}) }));
  else {
    for (const r of results) console.log(`${r.action === "error" ? "✗" : "✓"} ${r.path}: ${ACTION_TEXT[r.action]}${r.detail ? ` (${r.detail})` : ""}`);
    if (error) console.error(`[devi] ${error}`);
    else if (opts.action === "install") console.log("Listo. Abre una terminal nueva: `claude` ya abrirá Claude Code con Devi.");
    else console.log("Listo. En las terminales nuevas `claude` vuelve a ser el de siempre.");
  }
  return ok ? 0 : 1;
}
