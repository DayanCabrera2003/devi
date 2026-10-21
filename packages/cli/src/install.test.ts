import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeSteps, installBinary, isCompiledBinary, writeMarketplace } from "./install";

describe("install-integration", () => {
  test("detecta el binario compilado", () => {
    expect(isCompiledBinary("/$bunfs/root/devi")).toBe(true);
    expect(isCompiledBinary("B:\\~BUN\\root\\devi.exe")).toBe(true);
    expect(isCompiledBinary("/repo/packages/cli/src/main.ts")).toBe(false);
    expect(isCompiledBinary(undefined)).toBe(false);
  });

  test("copia el binario con permisos de ejecución y no se copia sobre sí mismo", async () => {
    const d = mkdtempSync(join(tmpdir(), "devi-install-"));
    writeFileSync(join(d, "src-devi"), "binario");
    const to = join(d, "bin", "devi");
    expect(await installBinary(join(d, "src-devi"), to, "linux")).toBe("copied");
    expect(readFileSync(to, "utf8")).toBe("binario");
    expect(statSync(to).mode & 0o111).not.toBe(0);
    expect(await installBinary(to, to, "linux")).toBe("same");
  });

  test("escribe el marketplace", async () => {
    const d = mkdtempSync(join(tmpdir(), "devi-mp-"));
    const written = await writeMarketplace(d, "/b/devi", "1.0.0");
    expect(written.length).toBe(2);
    const plugin = JSON.parse(readFileSync(join(d, "devi/.claude-plugin/plugin.json"), "utf8"));
    expect(plugin.mcpServers.devi).toEqual({ command: "/b/devi", args: ["mcp"] });
  });

  test("pasos de claude: añade e instala la primera vez; actualiza después", () => {
    expect(claudeSteps({ marketplaceDir: "/m", marketplaces: [], plugins: [] })).toEqual([
      ["plugin", "marketplace", "add", "/m"],
      ["plugin", "install", "devi@devi-local", "--scope", "user"],
    ]);
    expect(claudeSteps({ marketplaceDir: "/m", marketplaces: [{ name: "devi-local" }], plugins: [{ id: "devi@devi-local" }] })).toEqual([
      ["plugin", "marketplace", "update", "devi-local"],
      ["plugin", "update", "devi@devi-local", "--scope", "user"],
    ]);
  });
});
