import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Sys } from "../paths";
import {
  BLOCK_BEGIN,
  BLOCK_END,
  aliasStatus,
  aliasTargets,
  installAlias,
  removeAlias,
  renderBlock,
  runShellAlias,
  stripBlock,
  upsertBlock,
} from "./shell-alias";

let home: string;
const noPwsh = { which: () => null };
const linux = (env: Record<string, string> = {}): Sys => ({ platform: "linux", env, home });
const DEVI = "/opt/devi/bin/devi";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "devi-alias-"));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

const read = (p: string) => readFileSync(p, "utf8");

describe("bloques", () => {
  test("sh: función claude que pasa los args a devi claude, con salida de escape", () => {
    const b = renderBlock("sh", DEVI);
    expect(b.startsWith(BLOCK_BEGIN)).toBe(true);
    expect(b.trimEnd().endsWith(BLOCK_END)).toBe(true);
    expect(b).toContain(`'${DEVI}' claude -- "$@"`);
    expect(b).toContain("DEVI_NO_ALIAS");
    expect(b).toContain("command claude");
  });

  test("con DEVI_NO_ALIAS=1 al cargar el rc, la función claude no se define (sh, fish, PowerShell)", () => {
    const sh = renderBlock("sh", DEVI);
    expect(sh).toContain('if [ "${DEVI_NO_ALIAS:-}" != 1 ]; then');
    expect(sh.indexOf("DEVI_NO_ALIAS:-}\" != 1")).toBeLessThan(sh.indexOf("function claude"));
    const fish = renderBlock("fish", DEVI);
    expect(fish).toContain('if test "$DEVI_NO_ALIAS" != 1');
    expect(fish.indexOf('!= 1')).toBeLessThan(fish.indexOf("function claude"));
    const ps = renderBlock("powershell", DEVI);
    expect(ps).toContain("if ($env:DEVI_NO_ALIAS -ne '1') {");
  });

  test("sh: la ruta va entre comillas simples escapadas", () => {
    expect(renderBlock("sh", "/a b/it's/devi")).toContain(`'/a b/it'\\''s/devi' claude -- "$@"`);
  });

  test("fish y PowerShell", () => {
    expect(renderBlock("fish", DEVI)).toContain(`'${DEVI}' claude -- $argv`);
    const ps = renderBlock("powershell", "C:\\Users\\o'neil\\devi.exe");
    expect(ps).toContain(`& 'C:\\Users\\o''neil\\devi.exe' claude '--' @args`);
    expect(ps).toContain("DEVI_NO_ALIAS");
    expect(ps).toContain("claude.exe");
  });

  test("upsert añade al final y reemplaza el bloque existente sin tocar lo de fuera", () => {
    const b1 = renderBlock("sh", "/v1/devi");
    const b2 = renderBlock("sh", "/v2/devi");
    const once = upsertBlock("export A=1", b1);
    expect(once).toBe(`export A=1\n${b1}`);
    const twice = upsertBlock(`${once}export B=2\n`, b2);
    expect(twice).toBe(`export A=1\n${b2}export B=2\n`);
    expect(stripBlock(twice)).toBe("export A=1\nexport B=2\n");
    expect(stripBlock("export A=1\n")).toBeNull();
  });

  test("respeta los finales de línea CRLF", () => {
    const out = upsertBlock("Set-Alias x y\r\n", renderBlock("powershell", "C:\\d.exe"));
    expect(out.split("\n").slice(0, -1).every((l) => l.endsWith("\r"))).toBe(true);
  });

  test("marcas rotas: no se toca nada", () => {
    expect(() => upsertBlock(`${BLOCK_BEGIN}\nfoo\n`, renderBlock("sh", DEVI))).toThrow(/marcas/);
    expect(() => stripBlock(`${BLOCK_END}\n${BLOCK_BEGIN}\n`)).toThrow(/marcas/);
  });
});

describe("qué ficheros se tocan", () => {
  test("linux: los rc de zsh/bash que existen; fish solo si existe ~/.config/fish", () => {
    writeFileSync(join(home, ".bashrc"), "");
    expect(aliasTargets(linux({ SHELL: "/bin/zsh" }), noPwsh).map((t) => t.path)).toEqual([join(home, ".bashrc")]);
    writeFileSync(join(home, ".zshrc"), "");
    mkdirSync(join(home, ".config", "fish"), { recursive: true });
    expect(aliasTargets(linux(), noPwsh).map((t) => t.path)).toEqual([
      join(home, ".zshrc"),
      join(home, ".bashrc"),
      join(home, ".config", "fish", "functions", "claude.fish"),
    ]);
  });

  test("sin rc: el del $SHELL del usuario", () => {
    expect(aliasTargets(linux({ SHELL: "/usr/bin/zsh" }), noPwsh)).toEqual([{ path: join(home, ".zshrc"), kind: "sh" }]);
    expect(aliasTargets(linux({ SHELL: "/bin/bash" }), noPwsh)).toEqual([{ path: join(home, ".bashrc"), kind: "sh" }]);
    expect(aliasTargets({ platform: "darwin", env: { SHELL: "/bin/bash" }, home }, noPwsh)).toEqual([
      { path: join(home, ".bash_profile"), kind: "sh" },
    ]);
    expect(aliasTargets(linux({ SHELL: "/bin/sh" }), noPwsh)).toEqual([]);
  });

  test("ZDOTDIR absoluto manda para .zshrc", () => {
    const z = join(home, "zdot");
    mkdirSync(z);
    writeFileSync(join(z, ".zshrc"), "");
    expect(aliasTargets(linux({ ZDOTDIR: z }), noPwsh).map((t) => t.path)).toEqual([join(z, ".zshrc")]);
  });

  test("macOS: también ~/.bash_profile si existe", () => {
    writeFileSync(join(home, ".bashrc"), "");
    writeFileSync(join(home, ".bash_profile"), "");
    const mac: Sys = { platform: "darwin", env: {}, home };
    expect(aliasTargets(mac, noPwsh).map((t) => t.path)).toEqual([join(home, ".bashrc"), join(home, ".bash_profile")]);
    expect(aliasTargets(linux(), noPwsh).map((t) => t.path)).toEqual([join(home, ".bashrc")]);
  });

  test("pwsh en macOS/Linux solo si está instalado", () => {
    writeFileSync(join(home, ".zshrc"), "");
    const t = aliasTargets(linux(), { which: (c) => (c === "pwsh" ? "/usr/bin/pwsh" : null) });
    expect(t.at(-1)).toEqual({ path: join(home, ".config", "powershell", "Microsoft.PowerShell_profile.ps1"), kind: "powershell" });
  });

  test("Windows: los dos perfiles de PowerShell en USERPROFILE\\Documents, siempre", () => {
    const win: Sys = { platform: "win32", env: { USERPROFILE: "C:\\Users\\ana" }, home: "C:\\Users\\ana" };
    expect(aliasTargets(win, noPwsh)).toEqual([
      { path: "C:\\Users\\ana\\Documents\\PowerShell\\Microsoft.PowerShell_profile.ps1", kind: "powershell" },
      { path: "C:\\Users\\ana\\Documents\\WindowsPowerShell\\Microsoft.PowerShell_profile.ps1", kind: "powershell" },
    ]);
  });
});

describe("install / remove / status", () => {
  test("instala, es idempotente, hace copia una sola vez y remove deja el fichero como estaba", async () => {
    const rc = join(home, ".zshrc");
    writeFileSync(rc, "export A=1\n");
    chmodSync(rc, 0o600);
    const sys = linux();
    let r = await installAlias(sys, { ...noPwsh, deviPath: DEVI });
    expect(r).toEqual([{ path: rc, action: "installed" }]);
    expect(read(rc)).toBe(`export A=1\n${renderBlock("sh", DEVI)}`);
    expect(read(`${rc}.devi-backup`)).toBe("export A=1\n");
    expect(statSync(rc).mode & 0o777).toBe(0o600);

    writeFileSync(rc, `${read(rc)}export B=2\n`);
    r = await installAlias(sys, { ...noPwsh, deviPath: "/nuevo/devi" });
    expect(r).toEqual([{ path: rc, action: "updated" }]);
    expect(read(rc)).toBe(`export A=1\n${renderBlock("sh", "/nuevo/devi")}export B=2\n`);
    expect(read(`${rc}.devi-backup`)).toBe("export A=1\n");

    expect(await aliasStatus(sys, noPwsh)).toEqual({ installed: true, files: [{ path: rc, installed: true }] });
    expect(await removeAlias(sys, noPwsh)).toEqual([{ path: rc, action: "removed" }]);
    expect(read(rc)).toBe("export A=1\nexport B=2\n");
    expect(await aliasStatus(sys, noPwsh)).toEqual({ installed: false, files: [{ path: rc, installed: false }] });
    expect(existsSync(`${rc}.devi-backup`)).toBe(true);
  });

  test("crea el rc del $SHELL si no hay ninguno (sin copia de algo que no existía)", async () => {
    const r = await installAlias(linux({ SHELL: "/bin/bash" }), { ...noPwsh, deviPath: DEVI });
    expect(r).toEqual([{ path: join(home, ".bashrc"), action: "installed" }]);
    expect(read(join(home, ".bashrc"))).toBe(renderBlock("sh", DEVI));
    expect(existsSync(join(home, ".bashrc.devi-backup"))).toBe(false);
  });

  test("un rc enlazado (dotfiles) sigue siendo un enlace y se escribe el destino", async () => {
    const real = join(home, "dotfiles-zshrc");
    writeFileSync(real, "x\n");
    symlinkSync(real, join(home, ".zshrc"));
    await installAlias(linux(), { ...noPwsh, deviPath: DEVI });
    expect(read(real)).toContain(BLOCK_BEGIN);
    await removeAlias(linux(), noPwsh);
    expect(read(real)).toBe("x\n");
  });

  test("fish: fichero entero; no pisa una función claude del usuario; remove lo borra", async () => {
    mkdirSync(join(home, ".config", "fish"), { recursive: true });
    const f = join(home, ".config", "fish", "functions", "claude.fish");
    const sys = linux();
    expect(await installAlias(sys, { ...noPwsh, deviPath: DEVI })).toEqual([{ path: f, action: "installed" }]);
    expect(read(f)).toBe(renderBlock("fish", DEVI));
    expect(await removeAlias(sys, noPwsh)).toEqual([{ path: f, action: "removed" }]);
    expect(existsSync(f)).toBe(false);

    writeFileSync(f, "function claude; echo mío; end\n");
    const r = await installAlias(sys, { ...noPwsh, deviPath: DEVI });
    expect(r[0]).toMatchObject({ path: f, action: "skipped" });
    expect(await removeAlias(sys, noPwsh)).toEqual([{ path: f, action: "absent" }]);
    expect(read(f)).toBe("function claude; echo mío; end\n");
  });

  test("pwsh: crea el perfil y su carpeta", async () => {
    const sys = linux({ SHELL: "/bin/zsh" });
    const deps = { which: (c: string) => (c === "pwsh" ? "/usr/bin/pwsh" : null), deviPath: DEVI };
    await installAlias(sys, deps);
    const p = join(home, ".config", "powershell", "Microsoft.PowerShell_profile.ps1");
    expect(read(p)).toBe(renderBlock("powershell", DEVI));
    // remove encuentra el bloque aunque pwsh ya no esté instalado
    expect(await removeAlias(sys, noPwsh)).toContainEqual({ path: p, action: "removed" });
  });

  test("marcas rotas: error en ese fichero y no se modifica", async () => {
    const rc = join(home, ".zshrc");
    writeFileSync(rc, `${BLOCK_BEGIN}\nalgo\n`);
    const r = await installAlias(linux(), { ...noPwsh, deviPath: DEVI });
    expect(r[0]).toMatchObject({ path: rc, action: "error" });
    expect(read(rc)).toBe(`${BLOCK_BEGIN}\nalgo\n`);
  });
});

describe("runShellAlias", () => {
  function capture() {
    const lines: string[] = [];
    const log = spyOn(console, "log").mockImplementation((...a: unknown[]) => void lines.push(a.join(" ")));
    const err = spyOn(console, "error").mockImplementation((...a: unknown[]) => void lines.push(a.join(" ")));
    return { lines, restore: () => (log.mockRestore(), err.mockRestore()) };
  }

  test("install usa el binario estable de devi y falla si no está instalado", async () => {
    writeFileSync(join(home, ".zshrc"), "");
    const sys = linux();
    const c = capture();
    try {
      expect(await runShellAlias({ action: "install", json: false }, sys, noPwsh)).toBe(1);
      expect(c.lines.join("\n")).toContain("install-integration");
      const bin = join(home, ".local", "share", "devi", "bin", "devi");
      mkdirSync(join(bin, ".."), { recursive: true });
      writeFileSync(bin, "");
      expect(await runShellAlias({ action: "install", json: false }, sys, noPwsh)).toBe(0);
      expect(read(join(home, ".zshrc"))).toContain(`'${bin}' claude -- "$@"`);
      c.lines.length = 0;
      expect(await runShellAlias({ action: "status", json: true }, sys, noPwsh)).toBe(0);
      expect(JSON.parse(c.lines.at(-1)!)).toEqual({ installed: true, files: [{ path: join(home, ".zshrc"), installed: true }] });
      expect(await runShellAlias({ action: "remove", json: false }, sys, noPwsh)).toBe(0);
      expect(read(join(home, ".zshrc"))).toBe("");
    } finally {
      c.restore();
    }
  });

  test("install sin ningún shell compatible sale con 1", async () => {
    const c = capture();
    try {
      expect(await runShellAlias({ action: "install", json: false }, linux({ SHELL: "/bin/sh" }), { ...noPwsh, deviPath: DEVI })).toBe(1);
    } finally {
      c.restore();
    }
  });
});
