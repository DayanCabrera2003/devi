import { Database } from "bun:sqlite";

export type Migration = { version: number; sql: string };

// Abre la base de datos (":memory:" en tests) con WAL y claves foráneas.
export function openDb(path = ":memory:"): Database {
  const db = new Database(path, { create: true, strict: true });
  if (path !== ":memory:") db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA foreign_keys = ON");
  db.run("CREATE TABLE IF NOT EXISTS schema_versions (module TEXT PRIMARY KEY, version INTEGER NOT NULL)");
  return db;
}

// Aplica, en una transacción por migración, las que el módulo aún no tiene. Devuelve cuántas aplicó.
export function migrate(db: Database, module: string, migrations: Migration[]): number {
  const row = db.query("SELECT version FROM schema_versions WHERE module = ?").get(module) as { version: number } | null;
  const seen = new Set<number>();
  for (const m of migrations) {
    if (seen.has(m.version)) throw new Error(`migraciones duplicadas en "${module}": versión ${m.version}`);
    seen.add(m.version);
  }
  const current = row?.version ?? 0;
  const pending = [...migrations].sort((a, b) => a.version - b.version).filter((m) => m.version > current);
  for (const m of pending) {
    db.transaction(() => {
      db.exec(m.sql);
      db.run(
        "INSERT INTO schema_versions (module, version) VALUES (?, ?) ON CONFLICT(module) DO UPDATE SET version = excluded.version",
        [module, m.version],
      );
    })();
  }
  return pending.length;
}
