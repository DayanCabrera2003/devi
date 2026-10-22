// @vitest-environment node
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { DEMO_MARKER } from "./fixtures";

// El modo demo solo existe con `vite` en desarrollo: el build de producción no lleva ni sus datos.
describe("modo demo", () => {
  test("no entra en el build de producción", () => {
    const root = resolve(__dirname, "../..");
    const out = mkdtempSync(join(tmpdir(), "devi-build-"));
    try {
      // Vitest pone NODE_ENV=test; el build real corre con production.
      execFileSync("bunx", ["vite", "build", "--mode", "production", "--outDir", out, "--emptyOutDir", "--logLevel", "error"], {
        cwd: root,
        stdio: "pipe",
        env: { ...process.env, NODE_ENV: "production" },
      });
      const js = readdirSync(join(out, "assets")).filter((f) => f.endsWith(".js"));
      expect(js.length).toBeGreaterThan(0);
      const bundle = js.map((f) => readFileSync(join(out, "assets", f), "utf8")).join("\n");
      expect(bundle).toContain("Mensaje para"); // la app sí está
      expect(bundle).not.toContain(DEMO_MARKER);
      expect(bundle).not.toContain("qa-capturas-staging");
      expect(bundle).not.toContain("mockIPC");
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 120_000);
});
