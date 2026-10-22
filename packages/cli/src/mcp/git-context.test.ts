import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONTEXT_LIMITS } from "@devi/protocol";
import { type GitRunner, collectGitContext, runBounded } from "./git-context";

// Runner falso: responde según el subcomando (el primer argumento que no es opción global).
const fake = (answers: Record<string, string | null>): { run: GitRunner; seen: { cwd: string; args: string[] }[] } => {
  const seen: { cwd: string; args: string[] }[] = [];
  return {
    seen,
    run: async (cwd, args) => {
      seen.push({ cwd, args });
      const key = Object.keys(answers).find((k) => args.join(" ").includes(k));
      return key === undefined ? null : answers[key]!;
    },
  };
};

describe("contexto de git de la carpeta de la sesión", () => {
  test("rama, último commit y diff --stat, siempre en la carpeta de la sesión", async () => {
    const { run, seen } = fake({
      "--is-inside-work-tree": "true\n", "symbolic-ref": "feat/login\n", "log -1": "a1b2c3d Arregla el login\n",
      "diff --stat": " src/a.ts | 2 +-\n 1 file changed, 1 insertion(+), 1 deletion(-)\n",
    });
    expect(await collectGitContext("/proyecto", run)).toEqual({
      branch: "feat/login", commit: "a1b2c3d Arregla el login", diffStat: " src/a.ts | 2 +-\n 1 file changed, 1 insertion(+), 1 deletion(-)",
    });
    expect(seen.every((s) => s.cwd === "/proyecto")).toBe(true);
  });

  test("fuera de un repo git (o sin git instalado) → undefined, sin error y sin más llamadas", async () => {
    const { run, seen } = fake({});
    expect(await collectGitContext("/tmp", run)).toBeUndefined();
    expect(seen).toHaveLength(1);
  });

  test("sin cambios ni commits: solo lo que haya", async () => {
    const { run } = fake({ "--is-inside-work-tree": "true\n", "symbolic-ref": "main\n", "diff --stat": "" });
    expect(await collectGitContext("/p", run)).toEqual({ branch: "main" });
  });

  test("recorta el diff --stat a las líneas permitidas y avisa de cuántas faltan", async () => {
    const lines = Array.from({ length: 120 }, (_, i) => ` src/f${i}.ts | 1 +`);
    const { run } = fake({ "--is-inside-work-tree": "true", "symbolic-ref": "main", "diff --stat": `${lines.join("\n")}\n 120 files changed\n` });
    const ctx = await collectGitContext("/p", run);
    const out = ctx!.diffStat!.split("\n");
    expect(out).toHaveLength(CONTEXT_LIMITS.diffStatLines + 1);
    expect(out.at(-1)).toBe("… (71 líneas más; el diff completo, solo como archivo adjunto)");
    expect(ctx!.diffStat!.length).toBeLessThanOrEqual(CONTEXT_LIMITS.diffStatChars);
  });

  test("rama y asunto muy largos se recortan a sus límites", async () => {
    const { run } = fake({ "--is-inside-work-tree": "true", "symbolic-ref": "b".repeat(500), "log -1": `abc ${"s".repeat(900)}` });
    const ctx = await collectGitContext("/p", run);
    expect(ctx!.branch!.length).toBeLessThanOrEqual(CONTEXT_LIMITS.branchChars);
    expect(ctx!.commit!.length).toBeLessThanOrEqual(CONTEXT_LIMITS.commitChars);
  });

  test("con un repo de verdad", async () => {
    const dir = mkdtempSync(join(tmpdir(), "devi-git-"));
    const git = (...args: string[]) => Bun.spawnSync(["git", "-c", "user.name=T", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { cwd: dir });
    git("init", "-q", "-b", "trabajo");
    writeFileSync(join(dir, "a.txt"), "uno\n");
    git("add", "a.txt");
    git("commit", "-q", "-m", "Primer commit");
    writeFileSync(join(dir, "a.txt"), "uno\ndos\n");
    const ctx = await collectGitContext(dir);
    expect(ctx?.branch).toBe("trabajo");
    expect(ctx?.commit).toMatch(/^[0-9a-f]{7,} Primer commit$/);
    expect(ctx?.diffStat).toContain("a.txt | 1 +");
    // Una carpeta que no es repo (dentro de tmp) no da error.
    const plain = mkdtempSync(join(tmpdir(), "devi-nogit-"));
    mkdirSync(join(plain, "sub"));
    expect(await collectGitContext(join(plain, "sub"))).toBeUndefined();
  });

  test("runBounded mata el proceso al vencer el plazo y devuelve null", async () => {
    const t0 = Date.now();
    expect(await runBounded([process.execPath, "-e", "setTimeout(() => {}, 10000)"], tmpdir(), 200)).toBeNull();
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(await runBounded(["programa-que-no-existe-devi"], tmpdir(), 200)).toBeNull();
  });
});
