import type { Database } from "bun:sqlite";
import type { Migration } from "../../core/db";

export const settingsMigrations: Migration[] = [
  { version: 1, sql: "CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)" },
];

// Ajustes como clave → JSON. Solo se guardan los que el admin cambia; el resto sale de DEFAULT_SETTINGS.
export class SettingsStore {
  constructor(private db: Database) {}

  all(): Record<string, unknown> {
    const rows = this.db.query("SELECT key, value FROM settings").all() as { key: string; value: string }[];
    return Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)]));
  }

  set(key: string, value: unknown): void {
    this.db
      .query("INSERT INTO settings (key, value) VALUES ($key, $value) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run({ key, value: JSON.stringify(value) });
  }
}
