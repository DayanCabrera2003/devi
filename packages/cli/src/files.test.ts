import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLocalFiles, safeFileName, uniqueName } from "./files";

const cwd = mkdtempSync(join(tmpdir(), "devi-files-"));
writeFileSync(join(cwd, "a.txt"), "hola ñandú");
mkdirSync(join(cwd, "sub"));
writeFileSync(join(cwd, "sub", "b.md"), "# b");
writeFileSync(join(cwd, "sub", "a.txt"), "otro a");
writeFileSync(join(cwd, "grande.txt"), "x".repeat(1_048_577));
writeFileSync(join(cwd, "bin.dat"), new Uint8Array([104, 0, 105]));
writeFileSync(join(cwd, "latin1.txt"), new Uint8Array([0xf1, 0x61]));

describe("readLocalFiles", () => {
  test("lee archivos de texto relativos al cwd y absolutos", async () => {
    const r = await readLocalFiles(["a.txt", join(cwd, "sub", "b.md")], cwd);
    expect(r).toEqual({ ok: true, files: [{ name: "a.txt", content: "hola ñandú" }, { name: "b.md", content: "# b" }] });
  });

  test("sin archivos → lista vacía", async () => {
    expect(await readLocalFiles([], cwd)).toEqual({ ok: true, files: [] });
  });

  test("rechaza más de 5", async () => {
    const r = await readLocalFiles(["a.txt", "a.txt", "a.txt", "a.txt", "a.txt", "a.txt"], cwd);
    expect(r).toEqual({ ok: false, error: "Demasiados archivos: 6 (máximo 5 por solicitud)." });
  });

  test("junta todos los errores y no devuelve nada", async () => {
    const r = await readLocalFiles(["no-existe.txt", "sub", "grande.txt", "bin.dat", "latin1.txt"], cwd);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("no-existe.txt: no existe");
    expect(r.error).toContain("sub: no es un archivo");
    expect(r.error).toContain("grande.txt: ocupa 1025 KB (máximo 1024 KB)");
    expect(r.error).toContain("bin.dat: parece binario");
    expect(r.error).toContain("latin1.txt: no es texto UTF-8 válido");
  });

  test("dos archivos con el mismo nombre", async () => {
    const r = await readLocalFiles(["a.txt", "sub/a.txt"], cwd);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('ya hay otro archivo llamado "a.txt"');
  });
});

test("safeFileName quita rutas y caracteres peligrosos", () => {
  expect(safeFileName("../../etc/passwd")).toBe("passwd");
  expect(safeFileName("..\\..\\win.ini")).toBe("win.ini");
  expect(safeFileName("a<b>:c?.txt")).toBe("a_b__c_.txt");
  expect(safeFileName("..")).toBe("archivo");
  expect(safeFileName(".env")).toBe("env");
  expect(safeFileName("")).toBe("archivo");
});

describe("readLocalFiles: confinamiento al cwd", () => {
  const outside = mkdtempSync(join(tmpdir(), "devi-outside-"));
  writeFileSync(join(outside, "secreto.txt"), "clave");
  const project = mkdtempSync(join(tmpdir(), "devi-proj-"));
  writeFileSync(join(project, "ok.txt"), "ok");
  symlinkSync(join(outside, "secreto.txt"), join(project, "enlace.txt"));

  test("rechaza una ruta absoluta fuera del proyecto", async () => {
    const r = await readLocalFiles([join(outside, "secreto.txt")], project);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("Solo se pueden adjuntar archivos dentro del proyecto");
  });

  test("rechaza ../ que escapa", async () => {
    const r = await readLocalFiles([`../${outside.split("/").pop()}/secreto.txt`], project);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("Solo se pueden adjuntar archivos dentro del proyecto");
  });

  test("rechaza un symlink que apunta fuera", async () => {
    const r = await readLocalFiles(["enlace.txt"], project);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("Solo se pueden adjuntar archivos dentro del proyecto");
  });

  test("acepta un archivo relativo normal", async () => {
    expect(await readLocalFiles(["ok.txt"], project)).toEqual({ ok: true, files: [{ name: "ok.txt", content: "ok" }] });
  });
});

test("safeFileName: nombres reservados de Windows y puntos/espacios finales", () => {
  expect(safeFileName("CON")).toBe("_CON");
  expect(safeFileName("nul.txt")).toBe("_nul.txt");
  expect(safeFileName("com1.tar.gz")).toBe("_com1.tar.gz");
  expect(safeFileName("LPT9")).toBe("_LPT9");
  expect(safeFileName("console.txt")).toBe("console.txt");
  expect(safeFileName("a.txt. . ")).toBe("a.txt");
  expect(safeFileName("...")).toBe("archivo");
  expect(safeFileName("con. ")).toBe("_con");
});

test("uniqueName numera los repetidos", () => {
  const used = new Set<string>();
  expect(uniqueName("a.txt", used)).toBe("a.txt");
  expect(uniqueName("a.txt", used)).toBe("a (2).txt");
  expect(uniqueName("A.txt", used)).toBe("A (3).txt");
  expect(uniqueName("Makefile", used)).toBe("Makefile");
  expect(uniqueName("Makefile", used)).toBe("Makefile (2)");
});
