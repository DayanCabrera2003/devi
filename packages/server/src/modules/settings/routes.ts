import { API } from "@devi/protocol";
import { readBody } from "../../core/body";
import { json } from "../../core/http";
import type { ModuleContext } from "../../core/module";
import type { Router } from "../../core/router";
import type { SettingsManager } from "./service";

export function registerSettingsRoutes(r: Router, ctx: ModuleContext, settings: SettingsManager): void {
  r.on(API.getSettings, () => json(settings.get()));

  r.on(API.updateSettings, async ({ request, principal, access }) => {
    const before = settings.get();
    const after = settings.update(await readBody(request, API.updateSettings.body), principal.login);
    ctx.services.find("audit")?.record({
      actorMemberId: access.memberId, actorLogin: principal.login, action: "settings.updated", targetType: "settings",
      details: { before: JSON.stringify(before), after: JSON.stringify(after) },
    });
    return json(after);
  });

  // Copia completa (los bytes de devi.db) de la base de datos (también funciona con :memory:).
  r.on(API.exportDb, ({ principal, access }) => {
    ctx.services.find("audit")?.record({ actorMemberId: access.memberId, actorLogin: principal.login, action: "db.exported", targetType: "db" });
    return new Response(ctx.db.serialize(), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": 'attachment; filename="devi.db"',
      },
    });
  });
}
