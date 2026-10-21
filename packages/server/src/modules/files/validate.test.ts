import { describe, expect, test } from "bun:test";
import { FILE_LIMITS } from "@devi/protocol";
import { HttpError } from "../../core/http";
import { sanitizeFileName, uniqueNames, validateFiles } from "./validate";

const text = (name: string, content: string) => new File([content], name);
const raw = (name: string, bytes: number[]) => new File([new Uint8Array(bytes)], name);
const errorOf = async (files: File[]) => (await validateFiles(files).catch((e) => e)) as HttpError;

describe("sanitizeFileName", () => {
  test("quita rutas y '..'", () => {
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFileName("..\\..\\win.ini")).toBe("win.ini");
    expect(sanitizeFileName("..")).toBe("archivo.txt");
    expect(sanitizeFileName(".bashrc")).toBe("bashrc");
  });
  test("caracteres de control y reservados", () => {
    expect(sanitizeFileName("a\u0000b<c>:d.txt")).toBe("a_b_c__d.txt");
    expect(sanitizeFileName("CON.txt")).toBe("_CON.txt");
    expect(sanitizeFileName("   ")).toBe("archivo.txt");
  });
  test("longitud acotada conservando la extensión", () => {
    const n = sanitizeFileName(`${"x".repeat(300)}.log`);
    expect(n.length).toBe(120);
    expect(n.endsWith(".log")).toBe(true);
  });
  test("nombres repetidos", () => {
    expect(uniqueNames(["log.txt", "log.txt", "LOG.txt", "notas"])).toEqual(["log.txt", "log (2).txt", "LOG (3).txt", "notas"]);
  });
});

describe("validateFiles", () => {
  test("texto válido: nombre saneado, tamaño y sha256", async () => {
    const [f] = await validateFiles([text("../notas.md", "hola ñandú\n")]);
    expect(f!.name).toBe("notas.md");
    expect(f!.size).toBe(new TextEncoder().encode("hola ñandú\n").byteLength);
    expect(f!.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(new TextDecoder().decode(f!.bytes)).toBe("hola ñandú\n");
  });

  test("ninguno es válido", async () => {
    expect(await validateFiles([])).toEqual([]);
  });

  test("más de 5 → 400", async () => {
    const files = Array.from({ length: FILE_LIMITS.maxFiles + 1 }, (_, i) => text(`${i}.txt`, "x"));
    const e = await errorOf(files);
    expect(e.status).toBe(400);
    expect(e.message).toContain("Como máximo 5");
  });

  test("más de 1 MB → 400", async () => {
    const e = await errorOf([text("grande.txt", "a".repeat(FILE_LIMITS.maxBytes + 1))]);
    expect(e.status).toBe(400);
    expect(e.message).toContain("1 MB");
  });

  test("exactamente 1 MB vale", async () => {
    expect(await validateFiles([text("justo.txt", "a".repeat(FILE_LIMITS.maxBytes))])).toHaveLength(1);
  });

  test("bytes NUL → 400", async () => {
    const e = await errorOf([raw("bin.dat", [104, 0, 105])]);
    expect(e.status).toBe(400);
    expect(e.message).toContain("NUL");
  });

  test("UTF-8 inválido → 400", async () => {
    const e = await errorOf([raw("latin1.txt", [0x63, 0x61, 0xf1, 0x61])]);
    expect(e.status).toBe(400);
    expect(e.message).toContain("UTF-8");
    expect(e.extra.code).toBe("invalid_file");
  });
});
