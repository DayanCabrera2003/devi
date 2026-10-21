import { readFile, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { FILE_LIMITS } from "@devi/protocol";

export type LocalFile = { name: string; content: string };
export type FilesResult = { ok: true; files: LocalFile[] } | { ok: false; error: string };

const utf8 = new TextDecoder("utf-8", { fatal: true });
const kb = (n: number) => `${Math.ceil(n / 1024)} KB`;

// Valida en local los archivos que el agente quiere adjuntar, antes de subir nada.
// Las rutas relativas se resuelven respecto al cwd de la sesión. Si alguno falla, no se sube ninguno.
export async function readLocalFiles(paths: string[], cwd: string): Promise<FilesResult> {
  if (paths.length > FILE_LIMITS.maxFiles) {
    return { ok: false, error: `Demasiados archivos: ${paths.length} (máximo ${FILE_LIMITS.maxFiles} por solicitud).` };
  }
  const errors: string[] = [];
  const files: LocalFile[] = [];
  const seen = new Set<string>();
  let realCwd: string;
  try {
    realCwd = await realpath(cwd);
  } catch {
    return { ok: false, error: `No existe la carpeta de la sesión (${cwd}).` };
  }
  for (const p of paths) {
    const full = isAbsolute(p) ? p : resolve(cwd, p);
    const name = basename(full);
    let real: string;
    try {
      real = await realpath(full);
    } catch {
      errors.push(`${p}: no existe`);
      continue;
    }
    const rel = relative(realCwd, real);
    if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      errors.push(`${p}: Solo se pueden adjuntar archivos dentro del proyecto (${cwd})`);
      continue;
    }
    if (seen.has(name)) {
      errors.push(`${p}: ya hay otro archivo llamado "${name}" (renómbralo)`);
      continue;
    }
    seen.add(name);
    let info;
    try {
      info = await stat(real);
    } catch {
      errors.push(`${p}: no existe`);
      continue;
    }
    if (!info.isFile()) {
      errors.push(`${p}: no es un archivo`);
      continue;
    }
    if (info.size > FILE_LIMITS.maxBytes) {
      errors.push(`${p}: ocupa ${kb(info.size)} (máximo ${kb(FILE_LIMITS.maxBytes)})`);
      continue;
    }
    const bytes = await readFile(real);
    if (bytes.includes(0)) {
      errors.push(`${p}: parece binario (tiene bytes NUL); solo se admiten archivos de texto`);
      continue;
    }
    let content: string;
    try {
      content = utf8.decode(bytes);
    } catch {
      errors.push(`${p}: no es texto UTF-8 válido`);
      continue;
    }
    files.push({ name, content });
  }
  if (errors.length > 0) return { ok: false, error: `No se adjuntó nada. Revisa estos archivos:\n- ${errors.join("\n- ")}` };
  return { ok: true, files };
}

const WINDOWS_RESERVED = new Set([
  "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
  "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
]);
const MAX_NAME_CHARS = 120;
// char::is_control de Rust = categoría Cc (U+0000–U+001F y U+007F–U+009F).
const UNSAFE_CHARS = /[<>:"/\\|?*\u0000-\u001f\u007f-\u009f]/g;
// char::is_whitespace de Rust = propiedad Unicode White_Space (JS \s no coincide: incluye U+FEFF).
const EDGE_START = /^[.\p{White_Space}]+/u;
const EDGE_END = /[.\p{White_Space}]+$/u;
const asciiUpper = (s: string) => s.replace(/[a-z]/g, (c) => c.toUpperCase());

// Nombre seguro para guardar un archivo recibido. Es un espejo EXACTO de `sanitize_file_name` en
// apps/desktop/src-tauri/src/files.rs (y el MCP salta los archivos que ya existen), así que no cambiar
// un lado sin el otro: 1) última componente tras / o \; 2) caracteres de control (Cc) y <>:"/\|?* → _;
// 3) sin puntos ni espacios (Unicode) al inicio/final; 4) máximo 120 code points y de nuevo sin
// puntos/espacios finales; 5) vacío → "archivo"; 6) si lo anterior al primer punto, en mayúsculas
// ASCII y sin recortar, es un nombre reservado de Windows, lleva "_" delante.
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(UNSAFE_CHARS, "_").replace(EDGE_START, "").replace(EDGE_END, "");
  const clean = Array.from(cleaned).slice(0, MAX_NAME_CHARS).join("").replace(EDGE_END, "");
  if (clean === "") return "archivo";
  return WINDOWS_RESERVED.has(asciiUpper(clean.split(".")[0]!)) ? `_${clean}` : clean;
}

// `a.txt` → `a (2).txt` → `a (3).txt`… hasta que el nombre no esté en `used` (sin distinguir mayúsculas).
export function uniqueName(name: string, used: Set<string>): string {
  const dot = name.lastIndexOf(".");
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
  let candidate = name;
  for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${stem} (${n})${ext}`;
  used.add(candidate.toLowerCase());
  return candidate;
}
