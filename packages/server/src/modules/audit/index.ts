import { API, type AuditPage, AuditQuery, auditFeatureFor, legacyAuditAction, legacyAuditTarget } from "@devi/protocol";
import { json } from "../../core/http";
import type { DeviModule, ModuleContext } from "../../core/module";
import { AuditManager } from "./service";
import { AuditStore, auditMigrations } from "./store";

const DAY = 86_400_000;
const managers = new WeakMap<ModuleContext, AuditManager>();

// Una app anterior valida las acciones y los objetivos con un enum cerrado: uno solo desconocido rompería la página
// entera. Lo que el cliente no declara entender (features) sale como su equivalente antiguo, marcado con
// details.via = "chat".
function forClient(page: AuditPage, features: string[]): AuditPage {
  return {
    ...page,
    entries: page.entries.map((e) => {
      const need = auditFeatureFor(e.action);
      if (!need || features.includes(need)) return e;
      return { ...e, action: legacyAuditAction(e.action), targetType: legacyAuditTarget(e.targetType), details: { ...e.details, via: "chat" } };
    }),
  };
}

// Registro de auditoría: los demás módulos (y el núcleo) apuntan aquí lo que pasa con el servicio
// "audit". Solo lectura por HTTP (GET /audit, admins); retención de 365 días con un barrido diario.
export const auditModule: DeviModule = {
  name: "audit",
  migrations: auditMigrations,

  routes(r, ctx) {
    const audit = new AuditManager(new AuditStore(ctx.db), ctx);
    managers.set(ctx, audit);
    ctx.services.provide("audit", audit);
    r.on(API.audit, ({ url }) => {
      const q = AuditQuery.parse(Object.fromEntries(url.searchParams));
      const page = audit.page(q.limit, q.before);
      return json(forClient(page, q.features));
    });
  },

  onStart(ctx) {
    const audit = managers.get(ctx)!;
    const run = () => {
      const n = audit.runRetention();
      if (n > 0) ctx.log(`auditoría: ${n} entradas de más de un año borradas`);
    };
    run();
    ctx.timers.every(DAY, run);
  },
};
