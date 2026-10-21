import { FILE_LIMITS } from "@devi/protocol";
import { HttpError } from "../../core/http";
import type { ValidFile } from "../../core/services";

const MAX_NAME = 120;
const utf8 = new TextDecoder("utf-8", { fatal: true });
const invalid = (message: string) => new HttpError(400, message, { code: "invalid_file" });

// Nombre seguro: sin rutas, sin caracteres de control ni reservados, sin puntos al inicio,
// sin nombres reservados de Windows y con longitud acotada (conservando la extensión).
export function sanitizeFileName(raw: string): string {
  let name = (raw.split(/[\\/]/).pop() ?? "")
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "_")
    .trim()
    .replace(/^\.+/, "")
    .trim();
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(name)) name = `_${name}`;
  if (name.length > MAX_NAME) {
    const dot = name.lastIndexOf(".");
    const ext = dot > 0 && name.length - dot <= 10 ? name.slice(dot) : "";
    name = name.slice(0, MAX_NAME - ext.length) + ext;
  }
  return name || "archivo.txt";
}

// Si dos archivos acaban con el mismo nombre: "log.txt", "log (2).txt"…
export function uniqueNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((name) => {
    let candidate = name;
    const dot = name.lastIndexOf(".");
    const [base, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
    for (let i = 2; used.has(candidate.toLowerCase()); i++) candidate = `${base} (${i})${ext}`;
    used.add(candidate.toLowerCase());
    return candidate;
  });
}

// Misma validación que hace el MCP antes de subir: como máximo 5, ≤ 1 MB, UTF-8 válido, sin NUL.
export async function validateFiles(files: File[]): Promise<ValidFile[]> {
  if (files.length > FILE_LIMITS.maxFiles) {
    throw invalid(`Como máximo ${FILE_LIMITS.maxFiles} archivos por solicitud (llegaron ${files.length})`);
  }
  const out: ValidFile[] = [];
  for (const f of files) {
    const name = sanitizeFileName(f.name);
    if (f.size > FILE_LIMITS.maxBytes) {
      throw invalid(`"${name}" pesa ${Math.ceil(f.size / 1024)} KB: el máximo es 1 MB por archivo`);
    }
    const bytes = await f.bytes();
    if (bytes.includes(0)) throw invalid(`"${name}" contiene bytes NUL: solo se admiten archivos de texto`);
    try {
      utf8.decode(bytes);
    } catch {
      throw invalid(`"${name}" no es texto UTF-8 válido`);
    }
    const sha256 = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
    out.push({ name, bytes, size: bytes.byteLength, sha256 });
  }
  const names = uniqueNames(out.map((f) => f.name));
  return out.map((f, i) => ({ ...f, name: names[i]! }));
}
