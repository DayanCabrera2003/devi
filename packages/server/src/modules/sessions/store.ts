import type { Database } from "bun:sqlite";
import type { InboxItem, Session } from "@devi/protocol";
import type { Migration } from "../../core/db";

export const sessionsMigrations: Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        member_id TEXT NOT NULL,
        name TEXT NOT NULL,
        cwd TEXT NOT NULL,
        parent_pid INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'working')),
        claude_session_id TEXT,
        last_seen INTEGER NOT NULL
      );
      CREATE INDEX sessions_member ON sessions(member_id);
    `,
  },
  {
    // channel: la sesión tiene el canal cargado. session_inbox: entregas guardadas hasta que el MCP (con canal)
    // o un hook (sin canal) las confirman.
    version: 2,
    sql: `
      ALTER TABLE sessions ADD COLUMN channel INTEGER NOT NULL DEFAULT 0;
      CREATE TABLE session_inbox (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        content TEXT NOT NULL,
        meta TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        acked_at INTEGER
      );
      CREATE INDEX session_inbox_session ON session_inbox(session_id, created_at);
    `,
  },
];

export type InboxRecord = { id: string; sessionId: string; kind: InboxItem["kind"]; content: string; meta: string; createdAt: number };

export type SessionRecord = {
  id: string;
  memberId: string;
  name: string;
  cwd: string;
  parentPid: number;
  status: Session["status"];
  claudeSessionId: string | null;
  lastSeen: number;
  channel: boolean;
};

type Row = Omit<SessionRecord, "channel"> & { channel: number };
const COLS = `id, member_id AS memberId, name, cwd, parent_pid AS parentPid, status,
  claude_session_id AS claudeSessionId, last_seen AS lastSeen, channel`;
const rec = (r: Row | null): SessionRecord | null => (r ? { ...r, channel: r.channel === 1 } : null);

export class SessionsStore {
  constructor(private db: Database) {}

  insert(s: SessionRecord): void {
    this.db
      .query(
        `INSERT INTO sessions (id, member_id, name, cwd, parent_pid, status, claude_session_id, last_seen, channel)
         VALUES ($id, $memberId, $name, $cwd, $parentPid, $status, $claudeSessionId, $lastSeen, $channel)`,
      )
      .run({ ...s, channel: s.channel ? 1 : 0 });
  }

  get(id: string): SessionRecord | null {
    return rec(this.db.query(`SELECT ${COLS} FROM sessions WHERE id = $id`).get({ id }) as Row | null);
  }

  ofMember(memberId: string): SessionRecord[] {
    return (this.db
      .query(`SELECT ${COLS} FROM sessions WHERE member_id = $memberId ORDER BY name`)
      .all({ memberId }) as Row[]).map((r) => rec(r)!);
  }

  // Misma persona, mismo nombre y mismo Claude Code: el MCP se está volviendo a registrar.
  same(memberId: string, name: string, parentPid: number): SessionRecord | null {
    return rec(this.db
      .query(`SELECT ${COLS} FROM sessions WHERE member_id = $memberId AND name = $name AND parent_pid = $parentPid`)
      .get({ memberId, name, parentPid }) as Row | null);
  }

  updateOnReregister(id: string, cwd: string, channel: boolean, lastSeen: number): void {
    this.db
      .query("UPDATE sessions SET cwd = $cwd, channel = $channel, last_seen = $lastSeen WHERE id = $id")
      .run({ id, cwd, channel: channel ? 1 : 0, lastSeen });
  }

  // Sesiones que un nuevo registro sustituye: mismo nombre o mismo Claude Code (pid padre).
  replacedBy(memberId: string, name: string, parentPid: number): string[] {
    const rows = this.db
      .query("SELECT id FROM sessions WHERE member_id = $memberId AND (name = $name OR parent_pid = $parentPid)")
      .all({ memberId, name, parentPid }) as { id: string }[];
    return rows.map((r) => r.id);
  }

  // Emparejamiento hook ↔ MCP: primero por pid del proceso padre (Claude Code), luego por claude_session_id.
  // (Plan B de la Fase 2: si el pid no sirve, el registro traerá claudeSessionId y se guardará en esa
  // misma columna; esta consulta ya lo empareja sin cambios.)
  findForHook(memberId: string, parentPid: number, claudeSessionId: string): SessionRecord | null {
    return rec(
      (this.db
        .query(`SELECT ${COLS} FROM sessions WHERE member_id = $memberId AND parent_pid = $parentPid ORDER BY last_seen DESC`)
        .get({ memberId, parentPid }) as Row | null) ??
      (this.db
        .query(`SELECT ${COLS} FROM sessions WHERE member_id = $memberId AND claude_session_id = $claudeSessionId`)
        .get({ memberId, claudeSessionId }) as Row | null),
    );
  }

  updateFromHook(id: string, status: Session["status"], claudeSessionId: string, lastSeen: number): void {
    this.db
      .query("UPDATE sessions SET status = $status, claude_session_id = $claudeSessionId, last_seen = $lastSeen WHERE id = $id")
      .run({ id, status, claudeSessionId, lastSeen });
  }

  touch(id: string, lastSeen: number): void {
    this.db.query("UPDATE sessions SET last_seen = $lastSeen WHERE id = $id").run({ id, lastSeen });
  }

  delete(id: string): void {
    this.db.query("DELETE FROM session_inbox WHERE session_id = $id").run({ id });
    this.db.query("DELETE FROM sessions WHERE id = $id").run({ id });
  }

  // ---- bandeja --------------------------------------------------------------

  insertInbox(r: InboxRecord): void {
    this.db
      .query(
        `INSERT INTO session_inbox (id, session_id, kind, content, meta, created_at)
         VALUES ($id, $sessionId, $kind, $content, $meta, $createdAt)`,
      )
      .run(r);
  }

  // Sin confirmar, en orden de llegada.
  unacked(sessionId: string): InboxRecord[] {
    return this.db
      .query(
        `SELECT id, session_id AS sessionId, kind, content, meta, created_at AS createdAt FROM session_inbox
         WHERE session_id = $sessionId AND acked_at IS NULL ORDER BY created_at, rowid`,
      )
      .all({ sessionId }) as InboxRecord[];
  }

  // Solo las de sesiones de esa persona; las demás se ignoran.
  ack(memberId: string, ids: string[], now: number): void {
    const q = this.db.query(
      `UPDATE session_inbox SET acked_at = $now WHERE id = $id AND acked_at IS NULL
         AND session_id IN (SELECT id FROM sessions WHERE member_id = $memberId)`,
    );
    this.db.transaction(() => {
      for (const id of ids) q.run({ id, memberId, now });
    })();
  }

  // Borra las confirmadas y las que llevan demasiado tiempo sin confirmar.
  sweepInbox(cutoff: number): number {
    return this.db.query("DELETE FROM session_inbox WHERE acked_at IS NOT NULL OR created_at < $cutoff").run({ cutoff }).changes;
  }

  seenBefore(cutoff: number): string[] {
    const rows = this.db.query("SELECT id FROM sessions WHERE last_seen < $cutoff").all({ cutoff }) as { id: string }[];
    return rows.map((r) => r.id);
  }
}
