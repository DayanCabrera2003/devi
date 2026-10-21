import type { DeviModule, ModuleContext } from "../../core/module";
import { registerFileRoutes } from "./routes";
import { FileManager } from "./service";
import { FilesStore, filesMigrations } from "./store";

// Eventos de requests que este módulo escucha. requests/index.ts los declara igual (las
// declaraciones idénticas se fusionan); así este archivo compila aunque requests aún no exista.
declare module "../../core/bus" {
  interface BusEvents {
    "draft.discarded": { draftId: string };
    "request.closed": { requestId: string };
  }
}

const HOUR = 3_600_000;
const managers = new WeakMap<ModuleContext, FileManager>();

// Archivos adjuntos: validación, almacenamiento en <dataDir>/files, descarga y retención.
// Ofrece el servicio "files" (requests lo usa al crear y autorizar borradores).
export const filesModule: DeviModule = {
  name: "files",
  migrations: filesMigrations,

  routes(r, ctx) {
    const files = new FileManager(new FilesStore(ctx.db), ctx.config.dataDir, ctx.now, () => ctx.services.get("settings").get());
    managers.set(ctx, files);
    ctx.services.provide("files", files);
    ctx.bus.on("draft.discarded", ({ draftId }) => files.releaseDraft(draftId));
    ctx.bus.on("request.closed", ({ requestId }) => files.releaseRequest(requestId));
    registerFileRoutes(r, ctx, files);
  },

  onStart(ctx) {
    const files = managers.get(ctx)!;
    const run = () => {
      const n = files.runRetention();
      if (n > 0) ctx.log(`retención: ${n} archivos borrados del servidor`);
    };
    run();
    ctx.timers.every(HOUR, run);
  },
};
