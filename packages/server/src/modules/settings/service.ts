import type { Database } from "bun:sqlite";
import { DEFAULT_SETTINGS, SettingsSchema, loginInDomains, type Settings } from "@devi/protocol";
import { HttpError } from "../../core/http";
import type { SettingsService } from "../../core/services";
import type { SettingsStore } from "./store";

const KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[];

export class SettingsManager implements SettingsService {
  constructor(
    private store: SettingsStore,
    private db: Database,
  ) {}

  get(): Settings {
    const saved = this.store.all();
    const known = Object.fromEntries(KEYS.filter((k) => k in saved).map((k) => [k, saved[k]]));
    return SettingsSchema.parse({ ...DEFAULT_SETTINGS, ...known });
  }

  // actorLogin: quien cambia los ajustes; no puede dejarse fuera con allowedDomains.
  update(patch: Partial<Settings>, actorLogin?: string): Settings {
    const merged = { ...this.get(), ...patch };
    const next = SettingsSchema.parse({ ...merged, allowedDomains: [...new Set(SettingsSchema.shape.allowedDomains.parse(merged.allowedDomains))] });
    if (actorLogin !== undefined && !loginInDomains(actorLogin, next.allowedDomains)) {
      throw new HttpError(400, `Con esos dominios te quedarías fuera (tu login: ${actorLogin}): incluye el tuyo`, { code: "invalid" });
    }
    if (next.fileMaxAgeDays < next.fileRetentionDays) {
      throw new HttpError(400, "fileMaxAgeDays (tope de archivos) no puede ser menor que fileRetentionDays (retención)", { code: "invalid" });
    }
    this.db.transaction(() => {
      for (const k of KEYS) if (patch[k] !== undefined) this.store.set(k, next[k]);
    })();
    return next;
  }

  // --allowed-domain: añade los dominios que falten (idempotente). Devuelve los añadidos.
  seedDomains(domains: string[]): string[] {
    const current = this.get().allowedDomains;
    const added = domains.filter((d) => !current.includes(d));
    if (added.length > 0) this.store.set("allowedDomains", [...current, ...added]);
    return added;
  }
}
