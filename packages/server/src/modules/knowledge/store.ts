import type { Database } from "bun:sqlite";
import type { Migration } from "../../core/db";

export const knowledgeMigrations: Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE knowledge_entries (
        id TEXT PRIMARY KEY,
        request_id TEXT NOT NULL UNIQUE,
        question TEXT NOT NULL,
        answer TEXT NOT NULL,
        asked_by TEXT NOT NULL,
        answered_by TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX knowledge_entries_created ON knowledge_entries (created_at);
      -- Índice de texto completo (FTS5), sin acentos ni mayúsculas. Se mantiene a mano en la misma transacción.
      CREATE VIRTUAL TABLE knowledge_fts USING fts5(
        entry_id UNINDEXED, question, answer, tokenize = 'unicode61 remove_diacritics 2'
      );
    `,
  },
];

export type KnowledgeRecord = {
  id: string;
  requestId: string;
  question: string;
  answer: string;
  askedBy: string;
  answeredBy: string;
  createdAt: number;
};

const COLS = `e.id, e.request_id AS requestId, e.question, e.answer, e.asked_by AS askedBy, e.answered_by AS answeredBy,
  e.created_at AS createdAt`;

// Palabras de la búsqueda como términos FTS5 entre comillas y con prefijo ("despl"*): así ningún símbolo de
// la sintaxis de FTS5 (OR, NEAR, *, :, paréntesis, comillas) que escriba alguien llega a interpretarse.
const MAX_TERMS = 12;
export function ftsTerms(q: string): string[] {
  return (q.normalize("NFC").match(/[\p{L}\p{N}_]+/gu) ?? []).slice(0, MAX_TERMS).map((t) => `"${t}"*`);
}

export class KnowledgeStore {
  constructor(private db: Database) {}

  // Devuelve false si esa solicitud ya estaba en la base (una respuesta se guarda una sola vez).
  insert(e: KnowledgeRecord): boolean {
    let inserted = false;
    this.db.transaction(() => {
      const res = this.db
        .query(
          `INSERT OR IGNORE INTO knowledge_entries (id, request_id, question, answer, asked_by, answered_by, created_at)
           VALUES ($id, $requestId, $question, $answer, $askedBy, $answeredBy, $createdAt)`,
        )
        .run(e);
      if (res.changes === 0) return;
      this.db.query("INSERT INTO knowledge_fts (entry_id, question, answer) VALUES ($id, $question, $answer)").run({
        id: e.id, question: e.question, answer: e.answer,
      });
      inserted = true;
    })();
    return inserted;
  }

  get(id: string): KnowledgeRecord | null {
    return this.db.query(`SELECT ${COLS} FROM knowledge_entries e WHERE e.id = $id`).get({ id }) as KnowledgeRecord | null;
  }

  delete(id: string): void {
    this.db.transaction(() => {
      this.db.query("DELETE FROM knowledge_fts WHERE entry_id = $id").run({ id });
      this.db.query("DELETE FROM knowledge_entries WHERE id = $id").run({ id });
    })();
  }

  recent(limit: number): KnowledgeRecord[] {
    return this.db
      .query(`SELECT ${COLS} FROM knowledge_entries e ORDER BY e.created_at DESC, e.id DESC LIMIT $limit`)
      .all({ limit }) as KnowledgeRecord[];
  }

  // Primero las que tienen todas las palabras; si no hay ninguna, las que tienen alguna. Por relevancia (bm25).
  search(q: string, limit: number): KnowledgeRecord[] {
    const terms = ftsTerms(q);
    if (terms.length === 0) return this.recent(limit);
    const all = this.match(terms.join(" AND "), limit);
    return all.length > 0 || terms.length === 1 ? all : this.match(terms.join(" OR "), limit);
  }

  private match(expr: string, limit: number): KnowledgeRecord[] {
    return this.db
      .query(
        `SELECT ${COLS} FROM knowledge_fts f JOIN knowledge_entries e ON e.id = f.entry_id
         WHERE knowledge_fts MATCH $expr ORDER BY bm25(knowledge_fts), e.created_at DESC LIMIT $limit`,
      )
      .all({ expr, limit }) as KnowledgeRecord[];
  }
}
