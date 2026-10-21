import { API } from "@devi/protocol";
import type { Router } from "../../core/router";
import type { FileManager } from "./service";

export function registerFileRoutes(r: Router, files: FileManager): void {
  // Vista previa o guardado desde la app (o el MCP). Siempre texto UTF-8.
  r.on(API.downloadFile, ({ params, access }) => {
    const f = files.download(access.memberId, params.id!);
    return new Response(Bun.file(f.absPath), {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`,
        "X-Devi-Sha256": f.sha256,
      },
    });
  });
}
