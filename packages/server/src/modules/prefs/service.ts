import type { Database } from "bun:sqlite";
import { DEFAULT_MEMBER_PREFS, type MemberPrefs, MemberPrefsSchema } from "@devi/protocol";
import type { PrefsService } from "../../core/services";
import type { PrefsStore } from "./store";

const KEYS = Object.keys(DEFAULT_MEMBER_PREFS) as (keyof MemberPrefs)[];

export class PrefsManager implements PrefsService {
  constructor(
    private store: PrefsStore,
    private db: Database,
  ) {}

  of(memberId: string): MemberPrefs {
    const saved = this.store.of(memberId);
    const known = Object.fromEntries(KEYS.filter((k) => k in saved).map((k) => [k, saved[k]]));
    return MemberPrefsSchema.parse({ ...DEFAULT_MEMBER_PREFS, ...known });
  }

  update(memberId: string, patch: Partial<MemberPrefs>): MemberPrefs {
    const next = MemberPrefsSchema.parse({ ...this.of(memberId), ...patch });
    this.db.transaction(() => {
      for (const k of KEYS) if (patch[k] !== undefined) this.store.set(memberId, k, next[k]);
    })();
    return next;
  }
}
