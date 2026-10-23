import { lstat, mkdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import type { DeviClient } from "@devi/client";
import { FileMetaSchema, type SessionDelivery, hasUntrustedFrame, untrustedFilesBlock, wrapUntrusted } from "@devi/protocol";
import { z } from "zod";
import { safeFileName, uniqueName } from "./files";

// Entrega lista para el agente: lo que se empuja por el canal (notifications/claude/channel { content, meta })
// o, sin canal, lo que el hook inyecta como contexto. Los dos caminos usan materializeDelivery: mismo saneado,
// mismas carpetas y los archivos que ya existen no se vuelven a descargar.
export type DeliveryMessage = { content: string; meta: Record<string, string> };

const FilesMeta = z.array(FileMetaSchema.pick({ id: true, name: true }));

// Convierte una entrega del servidor (por SSE o de la bandeja) en el mensaje para el agente. Si trae archivos (meta.files = JSON
// de [{id,name}]), se guardan en <receivedDir>/<request_id>/ (las respuestas, en .../respuesta/) y el agente recibe las rutas locales.
// Si la app ya los descargó, se reutilizan (no se vuelven a pedir).
// Mismo patrón que valida la app de escritorio; evita cualquier ruta en el nombre de la carpeta.
const REQUEST_ID = /^[A-Za-z0-9_-]{1,64}$/;

// Crea (si falta) y comprueba que cada componente de `parts` bajo `root` es una carpeta real, no un symlink.
async function safeFolder(root: string, parts: string[]): Promise<string> {
  let current = root;
  for (const part of parts) {
    current = join(current, part);
    try {
      await mkdir(current);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
    const info = await lstat(current);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`${current} no es una carpeta normal`);
  }
  return current;
}

// Solicitudes, respuestas y avisos de solicitud traen texto de un compañero. El servidor ya lo encuadra (DEVI-UNTRUSTED); si no
// trae marco (servidor antiguo o alterado), se encuadra aquí el contenido entero antes de dárselo al agente.
// El aviso request_notice también trae texto del compañero (el resumen del mensaje), y un mensaje del chat, el suyo.
const FRAMED: Partial<Record<SessionDelivery["kind"], string>> = {
  request: "Solicitud", response: "Respuesta", request_notice: "Aviso de solicitud", chat: "Mensaje del chat",
};
function framed(d: Pick<SessionDelivery, "kind" | "content" | "meta">): string {
  const label = FRAMED[d.kind];
  if (!label) return d.content;
  if (hasUntrustedFrame(d.content)) return d.content;
  const from = d.meta.from_name ?? d.meta.from ?? "un compañero";
  return wrapUntrusted(label, from, d.content, []);
}

export async function materializeDelivery(
  d: Pick<SessionDelivery, "kind" | "content" | "meta">,
  deps: { client: DeviClient; receivedDir: string },
): Promise<DeliveryMessage> {
  const meta: Record<string, string> = { ...d.meta, kind: d.kind };
  const raw = d.meta.files;
  d = { ...d, content: framed(d) };
  if ((d.kind !== "request" && d.kind !== "response" && d.kind !== "chat") || !raw) return { content: d.content, meta };

  let files: z.infer<typeof FilesMeta>;
  try {
    files = FilesMeta.parse(JSON.parse(raw));
  } catch {
    return { content: d.content, meta };
  }
  if (files.length === 0) return { content: d.content, meta };

  // La carpeta lleva el id de la solicitud o, en un mensaje del chat, el del mensaje.
  const idKey = d.kind === "chat" ? "message_id" : "request_id";
  const requestId = d.meta[idKey] ?? "";
  if (!REQUEST_ID.test(requestId)) throw new Error(`${idKey} inválido: "${requestId}" (solo letras, números, _ y -, máximo 64)`);

  const paths: string[] = [];
  const failed: string[] = [];
  let folder: string;
  try {
    await mkdir(deps.receivedDir, { recursive: true });
    folder = await safeFolder(await realpath(deps.receivedDir), d.kind === "response" ? [requestId, "respuesta"] : [requestId]);
  } catch {
    failed.push(...files.map((f) => f.name));
    files = [];
    folder = "";
  }
  const used = new Set<string>();
  for (const f of files) {
    const target = resolve(folder, uniqueName(safeFileName(f.name), used));
    if (!target.startsWith(folder + sep)) {
      failed.push(f.name);
      continue;
    }
    try {
      const existing = await lstat(target).catch(() => null);
      if (existing?.isSymbolicLink() || (existing && !existing.isFile())) throw new Error("destino no es un archivo normal");
      if (!existing) {
        // Se escribe a un temporal y se renombra: una escritura interrumpida nunca deja un archivo final a medias.
        const tmp = `${target}.tmp-${process.pid}`;
        try {
          await writeFile(tmp, await deps.client.downloadFile(f.id), { encoding: "utf8", flag: "wx" });
          await rename(tmp, target);
        } catch (e) {
          await rm(tmp, { force: true });
          throw e;
        }
      }
      paths.push(target);
    } catch {
      failed.push(f.name);
    }
  }
  delete meta.files;
  meta.file_paths = paths.join("\n");
  let content = d.content;
  if (paths.length > 0) content += `\n\n${untrustedFilesBlock(paths, "Archivos adjuntos (ya en este equipo)")}`;
  if (failed.length > 0) content += `\n\nNo se pudieron descargar: ${failed.join(", ")} (pídelos desde la app de Devi).`;
  return { content, meta };
}

