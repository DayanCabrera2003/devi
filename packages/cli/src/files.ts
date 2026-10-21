import { readFile, stat } from "node:fs/promises";
import { basename, isAbsolute, resolve } from "node:path";
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
  for (const p of paths) {
    const full = isAbsolute(p) ? p : resolve(cwd, p);
    const name = basename(full);
    if (seen.has(name)) {
      errors.push(`${p}: ya hay otro archivo llamado "${name}" (renómbralo)`);
      continue;
    }
    seen.add(name);
    let info;
    try {
      info = await stat(full);
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
    const bytes = await readFile(full);
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

// Nombre seguro para guardar un archivo recibido: sin rutas, sin caracteres reservados, sin "..".
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const clean = base.replace(/[<>:"|?*\u0000-\u001f]/g, "_").replace(/^\.+/, "").trim().slice(0, 200);
  return clean === "" ? "archivo" : clean;
}
