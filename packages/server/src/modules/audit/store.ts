import type { Database } from "bun:sqlite";
import type { AuditEntry } from "@devi/protocol";
import type { Migration } from "../../core/db";

export const auditMigrations: Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        at INTEGER NOT NULL,
        actor_member_id TEXT,
        actor_login TEXT NOT NULL,
        action TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT,
        details TEXT NOT NULL
      );
      CREATE INDEX audit_log_at ON audit_log (at);
      -- Solo se añade: ninguna fila se modifica (la retención solo borra las viejas).
      CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
      BEGIN SELECT RAISE(ABORT, 'audit_log solo se añade: no se modifica'); END;
    `,
  },
];

type Row = {
  id: number;
  at: number;
  actor_member_id: string | null;
  actor_login: string;
  action: string;
  target_type: string;
  target_id: string | null;
  details: string;
};

const toEntry = (r: Row): AuditEntry => ({
  id: r.id,
  at: r.at,
  ...(r.actor_member_id ? { actorMemberId: r.actor_member_id } : {}),
  actorLogin: r.actor_login,
  action: r.action as AuditEntry["action"],
  targetType: r.target_type as AuditEntry["targetType"],
  ...(r.target_id ? { targetId: r.target_id } : {}),
  details: JSON.parse(r.details) as Record<string, string>,
});

export class AuditStore {
  constructor(private db: Database) {}

  insert(e: Omit<AuditEntry, "id">): AuditEntry {
    const row = this.db
      .query(
        `INSERT INTO audit_log (at, actor_member_id, actor_login, action, target_type, target_id, details)
         VALUES ($at, $actor, $login, $action, $targetType, $targetId, $details) RETURNING *`,
      )
      .get({
        at: e.at, actor: e.actorMemberId ?? null, login: e.actorLogin, action: e.action, targetType: e.targetType,
        targetId: e.targetId ?? null, details: JSON.stringify(e.details),
      }) as Row;
    return toEntry(row);
  }

  // De la más nueva a la más vieja; before = id (exclusivo).
  page(limit: number, before: number | undefined): AuditEntry[] {
    const rows = this.db
      .query("SELECT * FROM audit_log WHERE ($before IS NULL OR id < $before) ORDER BY id DESC LIMIT $limit")
      .all({ before: before ?? null, limit }) as Row[];
    return rows.map(toEntry);
  }

  deleteOlderThan(at: number): number {
    return this.db.query("DELETE FROM audit_log WHERE at < $at").run({ at }).changes;
  }
}
