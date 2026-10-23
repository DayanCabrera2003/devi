import type { Database } from "bun:sqlite";
import type { ClaimTargetType } from "@devi/protocol";
import type { Migration } from "../../core/db";

export const claimsMigrations: Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE claims (
        code TEXT PRIMARY KEY,
        member_id TEXT NOT NULL,
        target_type TEXT NOT NULL CHECK (target_type IN ('request', 'response', 'chat')),
        target_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        used_at INTEGER,
        used_session TEXT,
        cancelled_at INTEGER,
        expired_notified INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX claims_member ON claims(member_id, expires_at);
    `,
  },
];

export type ClaimRecord = {
  code: string; memberId: string; targetType: ClaimTargetType; targetId: string; createdAt: number; expiresAt: number;
  usedAt: number | null; usedSession: string | null; cancelledAt: number | null;
};

const COLS = `code, member_id AS memberId, target_type AS targetType, target_id AS targetId, created_at AS createdAt,
  expires_at AS expiresAt, used_at AS usedAt, used_session AS usedSession, cancelled_at AS cancelledAt`;

export class ClaimsStore {
  constructor(private db: Database) {}

  exists(code: string): boolean {
    return this.db.query("SELECT 1 FROM claims WHERE code = $code").get({ code }) !== null;
  }

  insert(r: ClaimRecord): void {
    this.db
      .query(
        `INSERT INTO claims (code, member_id, target_type, target_id, created_at, expires_at)
         VALUES ($code, $memberId, $targetType, $targetId, $createdAt, $expiresAt)`,
      )
      .run({ code: r.code, memberId: r.memberId, targetType: r.targetType, targetId: r.targetId, createdAt: r.createdAt, expiresAt: r.expiresAt });
  }

  get(code: string): ClaimRecord | null {
    return (this.db.query(`SELECT ${COLS} FROM claims WHERE code = $code`).get({ code }) as ClaimRecord | null) ?? null;
  }

  open(memberId: string, now: number): ClaimRecord[] {
    return this.db
      .query(`SELECT ${COLS} FROM claims WHERE member_id = $memberId AND used_at IS NULL AND cancelled_at IS NULL AND expires_at > $now
              ORDER BY created_at`)
      .all({ memberId, now }) as ClaimRecord[];
  }

  // Reserva atómica: true si este canje se lo queda (vivo, sin usar ni cancelar).
  reserve(code: string, now: number): boolean {
    return (
      this.db
        .query("UPDATE claims SET used_at = $now WHERE code = $code AND used_at IS NULL AND cancelled_at IS NULL AND expires_at > $now")
        .run({ code, now }).changes === 1
    );
  }

  release(code: string): void {
    this.db.query("UPDATE claims SET used_at = NULL WHERE code = $code").run({ code });
  }

  recordSession(code: string, sessionId: string): void {
    this.db.query("UPDATE claims SET used_session = $sessionId WHERE code = $code").run({ code, sessionId });
  }

  cancel(code: string, now: number): boolean {
    return this.db.query("UPDATE claims SET cancelled_at = $now WHERE code = $code AND used_at IS NULL AND cancelled_at IS NULL").run({ code, now }).changes === 1;
  }

  // Caducados aún no avisados: se marcan y se devuelven (para el evento a la app).
  takeExpired(now: number): ClaimRecord[] {
    return this.db
      .query(
        `UPDATE claims SET expired_notified = 1
         WHERE used_at IS NULL AND cancelled_at IS NULL AND expires_at <= $now AND expired_notified = 0
         RETURNING ${COLS}`,
      )
      .all({ now }) as ClaimRecord[];
  }

  // Las filas viejas no hacen falta (el código caduca a los 10 min): se borran al día.
  purge(before: number): void {
    this.db.query("DELETE FROM claims WHERE expires_at < $before").run({ before });
  }
}
