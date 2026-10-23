import type { Database } from "bun:sqlite";
import type { Migration } from "../../core/db";

export const chatMigrations: Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE chat_messages (
        id TEXT PRIMARY KEY,
        from_member TEXT NOT NULL,
        to_member TEXT NOT NULL,
        text TEXT NOT NULL,
        origin TEXT NOT NULL CHECK (origin IN ('app', 'session')),
        from_session_name TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX chat_pair ON chat_messages(from_member, to_member, created_at);
    `,
  },
];

// Los adjuntos no van aquí: los guarda el servicio files con el id del mensaje.
export type ChatRecord = {
  id: string;
  fromMemberId: string;
  toMemberId: string;
  text: string;
  origin: "app" | "session";
  fromSessionName: string;
  createdAt: number;
};

const COLS = `id, from_member AS fromMemberId, to_member AS toMemberId, text, origin, from_session_name AS fromSessionName,
  created_at AS createdAt`;
// Los mensajes entre $a y $b, en los dos sentidos.
const PAIR = "((from_member = $a AND to_member = $b) OR (from_member = $b AND to_member = $a))";

export class ChatStore {
  constructor(private db: Database) {}

  transaction(fn: () => void): void {
    this.db.transaction(fn)();
  }

  insert(m: ChatRecord): void {
    this.db
      .query(
        `INSERT INTO chat_messages (id, from_member, to_member, text, origin, from_session_name, created_at)
         VALUES ($id, $fromMemberId, $toMemberId, $text, $origin, $fromSessionName, $createdAt)`,
      )
      .run(m);
  }

  get(id: string): ChatRecord | null {
    return (this.db.query(`SELECT ${COLS} FROM chat_messages WHERE id = $id`).get({ id }) as ChatRecord | null) ?? null;
  }

  // Una página más uno: si sobra uno, hay más y nextBefore es el createdAt del último devuelto.
  page(a: string, b: string, before: number | undefined, limit: number): { messages: ChatRecord[]; nextBefore?: number } {
    const rows = this.db
      .query(`SELECT ${COLS} FROM chat_messages WHERE ${PAIR} AND created_at < $before ORDER BY created_at DESC, rowid DESC LIMIT $n`)
      .all({ a, b, before: before ?? Number.MAX_SAFE_INTEGER, n: limit + 1 }) as ChatRecord[];
    if (rows.length <= limit) return { messages: rows };
    const messages = rows.slice(0, limit);
    return { messages, nextBefore: messages.at(-1)!.createdAt };
  }

  last(a: string, b: string): ChatRecord | null {
    return (
      (this.db.query(`SELECT ${COLS} FROM chat_messages WHERE ${PAIR} ORDER BY created_at DESC, rowid DESC LIMIT 1`).get({ a, b }) as ChatRecord | null) ??
      null
    );
  }
}
