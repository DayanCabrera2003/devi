import { API } from "@devi/protocol";
import { readBody } from "../../core/body";
import { json } from "../../core/http";
import type { Router } from "../../core/router";
import type { PrefsManager } from "./service";

// Cada persona lee y cambia solo las suyas (las de quien llama). Cambiarlas es humano: solo desde la app.
export function registerPrefsRoutes(r: Router, prefs: PrefsManager): void {
  r.on(API.myPrefs, ({ access }) => json(prefs.of(access.memberId)));
  r.on(API.updateMyPrefs, async ({ request, access }) => json(prefs.update(access.memberId, await readBody(request, API.updateMyPrefs.body))));
}
