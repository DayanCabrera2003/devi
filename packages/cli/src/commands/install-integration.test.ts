import { expect, spyOn, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CliArgError } from "../args";
import { fatalOutput } from "../main";
import { runInstallIntegration } from "./install-integration";

test("--json: un error de argumentos imprime { ok:false, error, steps } y sale con 1", () => {
  const out = fatalOutput(["install-integration", "--json", "--from"], new CliArgError("--from necesita un valor"));
  expect(out.code).toBe(1);
  expect(JSON.parse(out.stdout ?? "")).toEqual({ ok: false, error: "--from necesita un valor", steps: [] });
});

test("sin --json, los errores de argumentos siguen yendo a stderr con código 2", () => {
  expect(fatalOutput(["doctor", "--x"], new CliArgError("mal"))).toEqual({ code: 2, stderr: "mal" });
});

test("--json: si lanzar `claude` lanza, el informe final es JSON con ok:false y código 1", async () => {
  const d = mkdtempSync(join(tmpdir(), "devi-ii-"));
  writeFileSync(join(d, "devi-src"), "bin");
  const lines: string[] = [];
  const spy = spyOn(console, "log").mockImplementation((...a: unknown[]) => void lines.push(a.join(" ")));
  try {
    const code = await runInstallIntegration(
      { from: join(d, "devi-src"), binDir: join(d, "bin"), marketplaceDir: join(d, "mp"), skipClaude: false, json: true },
      { platform: "linux", env: {}, home: d },
      { run: async () => { throw new Error("spawn EACCES"); } },
    );
    expect(code).toBe(1);
  } finally {
    spy.mockRestore();
  }
  const last = JSON.parse(lines[lines.length - 1]!);
  expect(last.ok).toBe(false);
  expect(last.error).toContain("spawn EACCES");
  expect(last.steps.at(-1).detail).toContain("spawn EACCES");
});
