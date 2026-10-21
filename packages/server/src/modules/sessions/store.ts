import type { Database } from "bun:sqlite";
import type { Session } from "@devi/protocol";
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
];

export type SessionRecord = {
  id: string;
  memberId: string;
  name: string;
  cwd: string;
  parentPid: number;
  status: Session["status"];
  claudeSessionId: string | null;
  lastSeen: number;
};

const COLS = `id, member_id AS memberId, name, cwd, parent_pid AS parentPid, status,
  claude_session_id AS claudeSessionId, last_seen AS lastSeen`;

export class SessionsStore {
  constructor(private db: Database) {}

  insert(s: SessionRecord): void {
    this.db
      .query(
        `INSERT INTO sessions (id, member_id, name, cwd, parent_pid, status, claude_session_id, last_seen)
         VALUES ($id, $memberId, $name, $cwd, $parentPid, $status, $claudeSessionId, $lastSeen)`,
      )
      .run(s);
  }

  get(id: string): SessionRecord | null {
    return this.db.query(`SELECT ${COLS} FROM sessions WHERE id = $id`).get({ id }) as SessionRecord | null;
  }

  ofMember(memberId: string): SessionRecord[] {
    return this.db
      .query(`SELECT ${COLS} FROM sessions WHERE member_id = $memberId ORDER BY name`)
      .all({ memberId }) as SessionRecord[];
  }

  // Misma persona, mismo nombre y mismo Claude Code: el MCP se está volviendo a registrar.
  same(memberId: string, name: string, parentPid: number): SessionRecord | null {
    return this.db
      .query(`SELECT ${COLS} FROM sessions WHERE member_id = $memberId AND name = $name AND parent_pid = $parentPid`)
      .get({ memberId, name, parentPid }) as SessionRecord | null;
  }

  updateCwd(id: string, cwd: string, lastSeen: number): void {
    this.db.query("UPDATE sessions SET cwd = $cwd, last_seen = $lastSeen WHERE id = $id").run({ id, cwd, lastSeen });
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
    return (
      (this.db
        .query(`SELECT ${COLS} FROM sessions WHERE member_id = $memberId AND parent_pid = $parentPid ORDER BY last_seen DESC`)
        .get({ memberId, parentPid }) as SessionRecord | null) ??
      (this.db
        .query(`SELECT ${COLS} FROM sessions WHERE member_id = $memberId AND claude_session_id = $claudeSessionId`)
        .get({ memberId, claudeSessionId }) as SessionRecord | null)
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
    this.db.query("DELETE FROM sessions WHERE id = $id").run({ id });
  }

  seenBefore(cutoff: number): string[] {
    const rows = this.db.query("SELECT id FROM sessions WHERE last_seen < $cutoff").all({ cutoff }) as { id: string }[];
    return rows.map((r) => r.id);
  }
}
