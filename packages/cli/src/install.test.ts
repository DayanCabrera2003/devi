import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { rename as realRename } from "node:fs/promises";
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

describe("installBinary en Windows con el binario en uso", () => {
  const busy = () => Object.assign(new Error("busy"), { code: "EBUSY" });
  function setup() {
    const d = mkdtempSync(join(tmpdir(), "devi-reinstall-"));
    writeFileSync(join(d, "nuevo"), "nuevo");
    writeFileSync(join(d, "devi.exe"), "viejo");
    writeFileSync(join(d, "devi.exe.old-1"), "mas viejo");
    return d;
  }

  test("si renombrar sobre el binario falla con EBUSY, aparta el viejo y coloca el nuevo", async () => {
    const d = setup();
    const to = join(d, "devi.exe");
    let first = true;
    const rename = async (a: string, b: string) => {
      if (first) {
        first = false;
        throw busy();
      }
      return realRename(a, b);
    };
    expect(await installBinary(join(d, "nuevo"), to, "win32", { rename })).toBe("copied");
    expect(readFileSync(to, "utf8")).toBe("nuevo");
    const files = readdirSync(d);
    expect(files.some((f) => f.startsWith("devi.exe.old-") && f !== "devi.exe.old-1")).toBe(true);
    expect(files).not.toContain("devi.exe.old-1");
    expect(files.some((f) => f.includes(".tmp-"))).toBe(false);
  });

  test("si ni así se puede, borra el temporal y explica qué hacer", async () => {
    const d = setup();
    const to = join(d, "devi.exe");
    const rename = async () => {
      throw Object.assign(new Error("perm"), { code: "EPERM" });
    };
    await expect(installBinary(join(d, "nuevo"), to, "win32", { rename })).rejects.toThrow(
      "Cierra tus sesiones de Claude Code con Devi y vuelve a intentarlo",
    );
    expect(readdirSync(d).some((f) => f.includes(".tmp-"))).toBe(false);
    expect(existsSync(to)).toBe(true);
  });

  test("otros errores se propagan tal cual", async () => {
    const d = setup();
    const rename = async () => {
      throw Object.assign(new Error("nope"), { code: "ENOENT" });
    };
    await expect(installBinary(join(d, "nuevo"), join(d, "devi.exe"), "win32", { rename })).rejects.toThrow("nope");
  });
});
