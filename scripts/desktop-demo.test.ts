// El modo demo de la app (?demo=…) solo existe con `vite` en desarrollo: el build de producción
// no debe llevar ni su código ni sus datos de ejemplo.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const desktop = resolve(import.meta.dir, "../apps/desktop");
const marker = /DEMO_MARKER = "([^"]+)"/.exec(readFileSync(join(desktop, "src/demo/fixtures.ts"), "utf8"))![1]!;

describe("app de escritorio: modo demo", () => {
  test("no entra en el build de producción", () => {
    const out = mkdtempSync(join(tmpdir(), "devi-build-"));
    try {
      const r = Bun.spawnSync(["bunx", "vite", "build", "--mode", "production", "--outDir", out, "--emptyOutDir", "--logLevel", "error"], {
        cwd: desktop,
        env: { ...process.env, NODE_ENV: "production" },
      });
      expect(r.exitCode).toBe(0);
      const js = readdirSync(join(out, "assets")).filter((f) => f.endsWith(".js"));
      expect(js.length).toBeGreaterThan(0);
      const bundle = js.map((f) => readFileSync(join(out, "assets", f), "utf8")).join("\n");
      expect(bundle).toContain("Mensaje para"); // la app sí está
      expect(bundle).not.toContain(marker);
      expect(bundle).not.toContain("qa-capturas-staging");
      expect(bundle).not.toContain("mockIPC");
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 120_000);
});
