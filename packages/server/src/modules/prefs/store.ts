import type { Database } from "bun:sqlite";
import type { Migration } from "../../core/db";

export const prefsMigrations: Migration[] = [
  {
    version: 1,
    sql: "CREATE TABLE member_prefs (member_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (member_id, key))",
  },
];

// Preferencias por persona como clave → JSON. Solo se guardan las que la persona cambia; el resto sale de
// DEFAULT_MEMBER_PREFS.
export class PrefsStore {
  constructor(private db: Database) {}

  of(memberId: string): Record<string, unknown> {
    const rows = this.db.query("SELECT key, value FROM member_prefs WHERE member_id = $memberId").all({ memberId }) as {
      key: string;
      value: string;
    }[];
    return Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)]));
  }

  set(memberId: string, key: string, value: unknown): void {
    this.db
      .query(
        `INSERT INTO member_prefs (member_id, key, value) VALUES ($memberId, $key, $value)
         ON CONFLICT(member_id, key) DO UPDATE SET value = excluded.value`,
      )
      .run({ memberId, key, value: JSON.stringify(value) });
  }
}
