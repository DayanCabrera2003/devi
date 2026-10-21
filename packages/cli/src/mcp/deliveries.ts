import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import type { DeviClient } from "@devi/client";
import { FileMetaSchema, type SessionDelivery } from "@devi/protocol";
import { z } from "zod";
import { safeFileName, uniqueName } from "../files";

// Lo que se empuja por el canal: notifications/claude/channel { content, meta }.
export type ChannelMessage = { content: string; meta: Record<string, string> };

const FilesMeta = z.array(FileMetaSchema.pick({ id: true, name: true }));

// Convierte una entrega del servidor en el mensaje del canal. Si trae archivos (meta.files = JSON
// de [{id,name}]), se guardan en <receivedDir>/<request_id>/ y el agente recibe las rutas locales.
// Si la app ya los descargó, se reutilizan (no se vuelven a pedir).
export async function toChannelMessage(
  d: SessionDelivery,
  deps: { client: DeviClient; receivedDir: string },
): Promise<ChannelMessage> {
  const meta: Record<string, string> = { ...d.meta, kind: d.kind };
  const raw = d.meta.files;
  if ((d.kind !== "request" && d.kind !== "response") || !raw) return { content: d.content, meta };

  let files: z.infer<typeof FilesMeta>;
  try {
    files = FilesMeta.parse(JSON.parse(raw));
  } catch {
    return { content: d.content, meta };
  }
  if (files.length === 0) return { content: d.content, meta };

  const folder = resolve(deps.receivedDir, safeFileName(d.meta.request_id ?? "sin-id"));
  const paths: string[] = [];
  const failed: string[] = [];
  await mkdir(folder, { recursive: true });
  const used = new Set<string>();
  for (const f of files) {
    const target = resolve(folder, uniqueName(safeFileName(f.name), used));
    if (!target.startsWith(folder + sep)) {
      failed.push(f.name);
      continue;
    }
    try {
      const existing = Bun.file(target);
      if (!(await existing.exists())) {
        // Se escribe a un temporal y se renombra: una escritura interrumpida nunca deja un archivo final a medias.
        const tmp = `${target}.tmp-${process.pid}`;
        try {
          await writeFile(tmp, await deps.client.downloadFile(f.id), "utf8");
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
  if (paths.length > 0) content += `\n\nArchivos adjuntos (ya en este equipo):\n${paths.map((p) => `- ${p}`).join("\n")}`;
  if (failed.length > 0) content += `\n\nNo se pudieron descargar: ${failed.join(", ")} (pídelos desde la app de Devi).`;
  return { content, meta };
}

export const receivedFolderFor = (receivedDir: string, requestId: string) => join(receivedDir, safeFileName(requestId));
