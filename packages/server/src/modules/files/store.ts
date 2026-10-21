import type { Database } from "bun:sqlite";
import type { FileMeta } from "@devi/protocol";
import type { Migration } from "../../core/db";

export const filesMigrations: Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE files (
        id TEXT PRIMARY KEY,
        draft_id TEXT NOT NULL,
        request_id TEXT,
        direction TEXT NOT NULL CHECK (direction IN ('request', 'response')),
        name TEXT NOT NULL,
        size INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        path TEXT NOT NULL,
        author_member TEXT NOT NULL,
        peer_member TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        released_at INTEGER,
        deleted_at INTEGER
      );
      CREATE INDEX files_draft ON files(draft_id);
      CREATE INDEX files_request ON files(request_id);
    `,
  },
];

// path es relativo al directorio de datos (files/<id>), para poder mover la carpeta.
// author_member / peer_member: quién puede descargarlo (peer, solo tras autorizar el borrador).
// released_at: cuándo se cerró la solicitud o se descartó el borrador (empieza la retención).
export type FileRecord = {
  id: string;
  draftId: string;
  requestId: string | null;
  direction: "request" | "response";
  name: string;
  size: number;
  sha256: string;
  path: string;
  authorMemberId: string;
  peerMemberId: string;
  createdAt: number;
  releasedAt: number | null;
  deletedAt: number | null;
};

const COLS = `id, draft_id AS draftId, request_id AS requestId, direction, name, size, sha256, path,
  author_member AS authorMemberId, peer_member AS peerMemberId, created_at AS createdAt,
  released_at AS releasedAt, deleted_at AS deletedAt`;

const toMeta = (r: Pick<FileRecord, "id" | "name" | "size" | "direction">): FileMeta => ({
  id: r.id, name: r.name, size: r.size, direction: r.direction,
});

export class FilesStore {
  constructor(private db: Database) {}

  insert(f: FileRecord): void {
    this.db
      .query(
        `INSERT INTO files (id, draft_id, request_id, direction, name, size, sha256, path, author_member, peer_member,
                            created_at, released_at, deleted_at)
         VALUES ($id, $draftId, $requestId, $direction, $name, $size, $sha256, $path, $authorMemberId, $peerMemberId,
                 $createdAt, $releasedAt, $deletedAt)`,
      )
      .run(f);
  }

  get(id: string): FileRecord | null {
    return this.db.query(`SELECT ${COLS} FROM files WHERE id = $id`).get({ id }) as FileRecord | null;
  }

  metasOfDraft(draftId: string): FileMeta[] {
    const rows = this.db
      .query(`SELECT ${COLS} FROM files WHERE draft_id = $draftId ORDER BY rowid`)
      .all({ draftId }) as FileRecord[];
    return rows.map(toMeta);
  }

  metasOfRequest(requestId: string): FileMeta[] {
    const rows = this.db
      .query(`SELECT ${COLS} FROM files WHERE request_id = $requestId ORDER BY rowid`)
      .all({ requestId }) as FileRecord[];
    return rows.map(toMeta);
  }

  attach(draftId: string, requestId: string): void {
    this.db.query("UPDATE files SET request_id = $requestId WHERE draft_id = $draftId").run({ draftId, requestId });
  }

  releaseDraft(draftId: string, at: number): void {
    this.db
      .query("UPDATE files SET released_at = $at WHERE draft_id = $draftId AND released_at IS NULL")
      .run({ draftId, at });
  }

  releaseRequest(requestId: string, at: number): void {
    this.db
      .query("UPDATE files SET released_at = $at WHERE request_id = $requestId AND released_at IS NULL")
      .run({ requestId, at });
  }

  // Archivos que toca borrar: retención cumplida tras liberarse, o tope absoluto desde la subida.
  due(now: number, retentionMs: number, maxAgeMs: number): FileRecord[] {
    return this.db
      .query(
        `SELECT ${COLS} FROM files WHERE deleted_at IS NULL
         AND ((released_at IS NOT NULL AND released_at + $retentionMs <= $now) OR created_at + $maxAgeMs <= $now)`,
      )
      .all({ now, retentionMs, maxAgeMs }) as FileRecord[];
  }

  markDeleted(id: string, at: number): void {
    this.db.query("UPDATE files SET deleted_at = $at WHERE id = $id").run({ id, at });
  }
}
