import { CONTEXT_LIMITS as L, type GitContext } from "@devi/protocol";

// Contexto de git que el MCP añade a send_request: rama, último commit (hash corto + asunto) y `git diff --stat`
// acotado, siempre de la carpeta de ESTA sesión (nunca de la del servidor). Fuera de un repo, o sin git
// instalado, no hay contexto y no es un error. Cada orden tiene un plazo: un repo enorme o colgado no bloquea
// el envío.

const TIMEOUT_MS = 2_000;

// Ejecuta un comando sin shell en `cwd`. Devuelve la salida estándar si termina bien a tiempo; si falla, no
// existe o vence el plazo (se mata el proceso), null.
export async function runBounded(cmd: string[], cwd: string, timeoutMs = TIMEOUT_MS): Promise<string | null> {
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn(cmd, {
      cwd, stdin: "ignore", stdout: "pipe", stderr: "ignore",
      // Sin preguntas por terminal ni traducciones: la salida se lee tal cual.
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C" },
    });
  } catch {
    return null; // el programa no existe o la carpeta no es accesible
  }
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  try {
    const [out, code] = await Promise.all([new Response(proc.stdout as ReadableStream).text(), proc.exited]);
    return code === 0 && !proc.signalCode ? out : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export type GitRunner = (cwd: string, args: string[]) => Promise<string | null>;

// Opciones globales: sin paginador, sin fsmonitor (podría lanzar un programa configurado en el repo) y sin
// candados opcionales (no estorba al git que esté usando la persona).
const runGit: GitRunner = (cwd, args) =>
  runBounded(["git", "--no-pager", "--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "color.ui=never", ...args], cwd);

const cut = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

function boundDiffStat(raw: string): string | undefined {
  const lines = raw.replace(/\s+$/, "").split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return undefined;
  const kept = lines.slice(0, L.diffStatLines);
  const rest = lines.length - kept.length;
  const tail = rest > 0 ? `\n… (${rest} líneas más; el diff completo, solo como archivo adjunto)` : "";
  return cut(kept.join("\n"), L.diffStatChars - tail.length) + tail;
}

export async function collectGitContext(cwd: string, run: GitRunner = runGit): Promise<GitContext | undefined> {
  if ((await run(cwd, ["rev-parse", "--is-inside-work-tree"]))?.trim() !== "true") return undefined;
  const [branch, commit, diff] = await Promise.all([
    run(cwd, ["symbolic-ref", "--short", "-q", "HEAD"]), // en HEAD separado no hay rama
    run(cwd, ["log", "-1", "--format=%h %s"]),
    // Sin diff ni textconv externos: no se ejecuta nada configurado en el repo.
    run(cwd, ["diff", "--stat", "--no-ext-diff", "--no-textconv", "--no-color", "HEAD"]),
  ]);
  const ctx: GitContext = {};
  if (branch?.trim()) ctx.branch = cut(branch.trim(), L.branchChars);
  if (commit?.trim()) ctx.commit = cut(commit.trim(), L.commitChars);
  const stat = diff ? boundDiffStat(diff) : undefined;
  if (stat) ctx.diffStat = stat;
  return ctx;
}
