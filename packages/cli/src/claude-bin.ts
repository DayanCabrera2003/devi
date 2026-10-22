// Localiza el binario de Claude Code aunque la app se lance desde el menú del escritorio,
// donde el PATH no incluye lo que añaden ~/.zshrc o similares.
import { accessSync, constants, statSync } from "node:fs";
import { posix, win32 } from "node:path";

type Env = Record<string, string | undefined>;

export type FindClaudeDeps = {
  which: (cmd: string, pathEnv?: string) => string | null;
  isExecutable: (path: string) => boolean;
  // Ejecuta `$SHELL -lic 'unset -f claude; command -v claude'` y devuelve su stdout, o null.
  probeShell: (shell: string, env: Env) => Promise<string | null>;
};

const PROBE_TIMEOUT_MS = 3000;

export const defaultFindClaudeDeps: FindClaudeDeps = {
  which: (cmd, pathEnv) => Bun.which(cmd, pathEnv === undefined ? undefined : { PATH: pathEnv }),
  isExecutable: (p) => {
    try {
      if (!statSync(p).isFile()) return false;
      accessSync(p, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  },
  probeShell: async (shell, env) => {
    const proc = Bun.spawn([shell, "-lic", "unset -f claude 2>/dev/null; command -v claude"], {
      stdout: "pipe", stderr: "ignore", stdin: "ignore", env: env as Record<string, string>,
    });
    const timer = setTimeout(() => proc.kill(), PROBE_TIMEOUT_MS);
    try {
      const out = await new Response(proc.stdout).text();
      await proc.exited;
      return proc.signalCode ? null : out;
    } finally {
      clearTimeout(timer);
    }
  },
};

export function knownClaudePaths(env: Env, platform: NodeJS.Platform, home: string): string[] {
  if (platform === "win32") {
    const profile = env.USERPROFILE || home;
    const list = [win32.join(profile, ".local", "bin", "claude.exe")];
    if (env.APPDATA) list.push(win32.join(env.APPDATA, "npm", "claude.cmd"));
    if (env.LOCALAPPDATA) list.push(win32.join(env.LOCALAPPDATA, "Programs", "claude", "claude.exe"));
    return list;
  }
  return [
    posix.join(home, ".local/bin/claude"),
    posix.join(home, ".claude/local/claude"),
    posix.join(home, ".npm-global/bin/claude"),
    posix.join(home, ".bun/bin/claude"),
    "/usr/local/bin/claude",
    "/opt/homebrew/bin/claude",
    "/usr/bin/claude",
  ];
}

// Ruta absoluta de `claude` o null. Orden: override → PATH → rutas conocidas → shell de login (solo macOS/Linux).
export async function findClaude(
  env: Env,
  platform: NodeJS.Platform,
  home: string,
  deps: FindClaudeDeps = defaultFindClaudeDeps,
): Promise<string | null> {
  for (const override of [env.CLAUDE_BIN, env.DEVI_CLAUDE_BIN]) {
    if (override && deps.isExecutable(override)) return override;
  }
  const onPath = deps.which("claude", env.PATH ?? env.Path);
  if (onPath) return onPath;
  for (const p of knownClaudePaths(env, platform, home)) {
    if (deps.isExecutable(p)) return p;
  }
  if (platform === "win32" || !env.SHELL) return null;
  try {
    // DEVI_NO_ALIAS=1: el bloque de alias no define la función `claude` y no hay recursión.
    const out = await deps.probeShell(env.SHELL, { ...env, DEVI_NO_ALIAS: "1" });
    const last = (out ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean).at(-1);
    // `command -v` imprime solo el nombre si es función o alias: no vale.
    if (last && posix.isAbsolute(last) && deps.isExecutable(last)) return last;
  } catch {
    // El shell tardó o falló: se trata como no encontrado.
  }
  return null;
}

// Entorno para lanzar claude: su directorio va primero en el PATH (los plugins lanzan ayudantes del mismo sitio).
export function claudeSpawnEnv(base: Env, claudePath: string, platform: NodeJS.Platform): Env {
  const isWin = platform === "win32";
  const key = isWin ? (Object.keys(base).find((k) => k.toUpperCase() === "PATH") ?? "Path") : "PATH";
  const dir = (isWin ? win32 : posix).dirname(claudePath);
  const cur = base[key];
  return { ...base, [key]: cur ? `${dir}${isWin ? ";" : ":"}${cur}` : dir };
}

export const CLAUDE_NOT_FOUND =
  "No encuentro Claude Code. Instálalo (https://claude.com/claude-code) o indica su ruta con DEVI_CLAUDE_BIN.";
