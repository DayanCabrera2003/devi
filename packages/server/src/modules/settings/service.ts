import type { Database } from "bun:sqlite";
import { DEFAULT_SETTINGS, SettingsSchema, type Settings } from "@devi/protocol";
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

  update(patch: Partial<Settings>): Settings {
    const next = SettingsSchema.parse({ ...this.get(), ...patch });
    this.db.transaction(() => {
      for (const k of KEYS) if (patch[k] !== undefined) this.store.set(k, next[k]);
    })();
    return next;
  }
}
