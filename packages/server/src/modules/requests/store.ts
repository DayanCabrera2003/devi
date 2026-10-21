import type { Database } from "bun:sqlite";
import type { DeviRequest, Draft } from "@devi/protocol";
import type { Migration } from "../../core/db";

export const requestsMigrations: Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE drafts (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('request', 'response')),
        author_member TEXT NOT NULL,
        author_session TEXT NOT NULL,
        author_session_name TEXT NOT NULL,
        to_member TEXT,
        request_id TEXT,
        message TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('awaiting', 'authorized', 'discarded')),
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        CHECK ((kind = 'request' AND to_member IS NOT NULL) OR (kind = 'response' AND request_id IS NOT NULL))
      );
      CREATE INDEX drafts_status ON drafts(status);
      -- Como máximo un borrador de respuesta esperando por solicitud.
      CREATE UNIQUE INDEX drafts_one_awaiting_response ON drafts(request_id)
        WHERE kind = 'response' AND status = 'awaiting';

      CREATE TABLE requests (
        id TEXT PRIMARY KEY,
        from_member TEXT NOT NULL,
        from_session TEXT NOT NULL,
        from_session_name TEXT NOT NULL,
        to_member TEXT NOT NULL,
        message TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'forwarded', 'accepted', 'rejected', 'answered', 'timed_out', 'closed')),
        forwarded_session TEXT,
        outcome TEXT CHECK (outcome IN ('accepted', 'rejected', 'answered')),
        outcome_text TEXT,
        created_at INTEGER NOT NULL,
        sent_at INTEGER NOT NULL,
        deadline INTEGER NOT NULL
      );
      CREATE INDEX requests_to ON requests(to_member, status);
      CREATE INDEX requests_from ON requests(from_member, status);
    `,
  },
];

export type DraftRecord = {
  id: string;
  kind: Draft["kind"];
  authorMemberId: string;
  authorSessionId: string;
  authorSessionName: string;
  toMemberId: string | null; // kind=request
  requestId: string | null; // kind=response
  message: string;
  status: Draft["status"];
  createdAt: number;
  expiresAt: number;
};

export type RequestRecord = {
  id: string;
  fromMemberId: string;
  fromSessionId: string;
  fromSessionName: string;
  toMemberId: string;
  message: string;
  status: DeviRequest["status"];
  forwardedSessionId: string | null;
  outcome: NonNullable<DeviRequest["outcome"]> | null;
  outcomeText: string | null;
  createdAt: number;
  sentAt: number;
  deadline: number;
};

const DRAFT_COLS = `id, kind, author_member AS authorMemberId, author_session AS authorSessionId,
  author_session_name AS authorSessionName, to_member AS toMemberId, request_id AS requestId, message, status,
  created_at AS createdAt, expires_at AS expiresAt`;

const REQUEST_COLS = `id, from_member AS fromMemberId, from_session AS fromSessionId, from_session_name AS fromSessionName,
  to_member AS toMemberId, message, status, forwarded_session AS forwardedSessionId, outcome, outcome_text AS outcomeText,
  created_at AS createdAt, sent_at AS sentAt, deadline`;

export class RequestsStore {
  constructor(private db: Database) {}

  transaction(fn: () => void): void {
    this.db.transaction(fn)();
  }

  // ---- borradores -----------------------------------------------------------

  insertDraft(d: DraftRecord): void {
    this.db
      .query(
        `INSERT INTO drafts (id, kind, author_member, author_session, author_session_name, to_member, request_id, message,
                             status, created_at, expires_at)
         VALUES ($id, $kind, $authorMemberId, $authorSessionId, $authorSessionName, $toMemberId, $requestId, $message,
                 $status, $createdAt, $expiresAt)`,
      )
      .run(d);
  }

  getDraft(id: string): DraftRecord | null {
    return this.db.query(`SELECT ${DRAFT_COLS} FROM drafts WHERE id = $id`).get({ id }) as DraftRecord | null;
  }

  setDraftStatus(id: string, status: DraftRecord["status"]): void {
    this.db.query("UPDATE drafts SET status = $status WHERE id = $id").run({ id, status });
  }

  awaitingDrafts(): DraftRecord[] {
    return this.db
      .query(`SELECT ${DRAFT_COLS} FROM drafts WHERE status = 'awaiting' ORDER BY created_at`)
      .all() as DraftRecord[];
  }

  awaitingDraftsBy(memberId: string): DraftRecord[] {
    return this.db
      .query(`SELECT ${DRAFT_COLS} FROM drafts WHERE status = 'awaiting' AND author_member = $memberId ORDER BY created_at`)
      .all({ memberId }) as DraftRecord[];
  }

  awaitingResponseDraft(requestId: string): DraftRecord | null {
    return this.db
      .query(`SELECT ${DRAFT_COLS} FROM drafts WHERE kind = 'response' AND status = 'awaiting' AND request_id = $requestId`)
      .get({ requestId }) as DraftRecord | null;
  }

  // ---- solicitudes ----------------------------------------------------------

  insertRequest(r: RequestRecord): void {
    this.db
      .query(
        `INSERT INTO requests (id, from_member, from_session, from_session_name, to_member, message, status,
                               forwarded_session, outcome, outcome_text, created_at, sent_at, deadline)
         VALUES ($id, $fromMemberId, $fromSessionId, $fromSessionName, $toMemberId, $message, $status,
                 $forwardedSessionId, $outcome, $outcomeText, $createdAt, $sentAt, $deadline)`,
      )
      .run(r);
  }

  getRequest(id: string): RequestRecord | null {
    return this.db.query(`SELECT ${REQUEST_COLS} FROM requests WHERE id = $id`).get({ id }) as RequestRecord | null;
  }

  // Guarda los campos que cambian en las transiciones.
  saveRequest(r: RequestRecord): void {
    this.db
      .query(
        `UPDATE requests SET status = $status, forwarded_session = $forwardedSessionId, outcome = $outcome,
                             outcome_text = $outcomeText, sent_at = $sentAt, deadline = $deadline
         WHERE id = $id`,
      )
      .run({
        id: r.id, status: r.status, forwardedSessionId: r.forwardedSessionId, outcome: r.outcome,
        outcomeText: r.outcomeText, sentAt: r.sentAt, deadline: r.deadline,
      });
  }

  // Solicitudes con temporizador posible (pendientes o reenviadas).
  openRequests(): RequestRecord[] {
    return this.db
      .query(`SELECT ${REQUEST_COLS} FROM requests WHERE status IN ('pending', 'forwarded') ORDER BY created_at`)
      .all() as RequestRecord[];
  }

  // Lo que la app de una persona tiene que mostrar como tarjeta.
  cardsFor(memberId: string): RequestRecord[] {
    return this.db
      .query(
        `SELECT ${REQUEST_COLS} FROM requests
         WHERE (to_member = $memberId AND status = 'pending')
            OR (from_member = $memberId AND status IN ('accepted', 'rejected', 'answered', 'timed_out'))
         ORDER BY created_at`,
      )
      .all({ memberId }) as RequestRecord[];
  }
}
