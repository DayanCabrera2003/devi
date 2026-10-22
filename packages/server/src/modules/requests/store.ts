import type { Database } from "bun:sqlite";
import { type DeviRequest, type Draft, type RequestContext, RequestContextSchema } from "@devi/protocol";
import type { Migration } from "../../core/db";

// Texto de la última actividad cuando la respuesta no trae texto (aceptada sin nota).
const ACCEPTED_PREVIEW = "Aceptada";

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
  {
    // origin: quién la escribió (session = borrador autorizado; app = la persona desde la app).
    // responded_at: cuándo llegó la respuesta (para la última actividad de cada conversación).
    version: 2,
    sql: `
      ALTER TABLE requests ADD COLUMN origin TEXT NOT NULL DEFAULT 'session' CHECK (origin IN ('session', 'app'));
      ALTER TABLE requests ADD COLUMN responded_at INTEGER;
      CREATE INDEX requests_pair ON requests(from_member, to_member, created_at);
    `,
  },
  {
    // context: contexto opcional de la solicitud (JSON de RequestContext); el borrador lo guarda hasta enviarse.
    version: 3,
    sql: `
      ALTER TABLE drafts ADD COLUMN context TEXT;
      ALTER TABLE requests ADD COLUMN context TEXT;
    `,
  },
];

// Lee el JSON guardado; si no es válido (corrupto o de otra versión), como si no hubiera contexto.
function parseContext(row: { context: string | null } | null): RequestContext | undefined {
  if (!row?.context) return undefined;
  try {
    const parsed = RequestContextSchema.safeParse(JSON.parse(row.context));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

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
  origin?: DeviRequest["origin"]; // al insertar, session si falta; al leer, siempre está
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
  created_at AS createdAt, sent_at AS sentAt, deadline, origin`;

// Solicitudes entre $a y $b, en cualquier sentido.
const PAIR = `((from_member = $a AND to_member = $b) OR (from_member = $b AND to_member = $a))`;

export type LastActivity = { at: number; text: string; byMemberId: string };

export class RequestsStore {
  constructor(
    private db: Database,
    private now: () => number = Date.now, // para responded_at
  ) {}

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

  // ---- contexto -------------------------------------------------------------
  // Columna aparte de las de siempre: solo la leen las vistas (draftView/requestView) y las entregas.

  setDraftContext(id: string, context: RequestContext | undefined): void {
    this.db.query("UPDATE drafts SET context = $context WHERE id = $id").run({ id, context: context ? JSON.stringify(context) : null });
  }

  draftContext(id: string): RequestContext | undefined {
    return parseContext(this.db.query("SELECT context FROM drafts WHERE id = $id").get({ id }) as { context: string | null } | null);
  }

  setRequestContext(id: string, context: RequestContext | undefined): void {
    this.db.query("UPDATE requests SET context = $context WHERE id = $id").run({ id, context: context ? JSON.stringify(context) : null });
  }

  requestContext(id: string): RequestContext | undefined {
    return parseContext(this.db.query("SELECT context FROM requests WHERE id = $id").get({ id }) as { context: string | null } | null);
  }

  // ---- solicitudes ----------------------------------------------------------

  insertRequest(r: RequestRecord): void {
    this.db
      .query(
        `INSERT INTO requests (id, from_member, from_session, from_session_name, to_member, message, status,
                               forwarded_session, outcome, outcome_text, created_at, sent_at, deadline, origin)
         VALUES ($id, $fromMemberId, $fromSessionId, $fromSessionName, $toMemberId, $message, $status,
                 $forwardedSessionId, $outcome, $outcomeText, $createdAt, $sentAt, $deadline, $origin)`,
      )
      .run({ ...r, origin: r.origin ?? "session" });
  }

  getRequest(id: string): RequestRecord | null {
    return this.db.query(`SELECT ${REQUEST_COLS} FROM requests WHERE id = $id`).get({ id }) as RequestRecord | null;
  }

  // Guarda los campos que cambian en las transiciones.
  saveRequest(r: RequestRecord): void {
    this.db
      .query(
        `UPDATE requests SET status = $status, forwarded_session = $forwardedSessionId, outcome = $outcome,
                             outcome_text = $outcomeText, sent_at = $sentAt, deadline = $deadline,
                             responded_at = CASE WHEN responded_at IS NULL AND $outcome IS NOT NULL THEN $at ELSE responded_at END
         WHERE id = $id`,
      )
      .run({
        id: r.id, status: r.status, forwardedSessionId: r.forwardedSessionId, outcome: r.outcome,
        outcomeText: r.outcomeText, sentAt: r.sentAt, deadline: r.deadline, at: this.now(),
      });
  }

  // Solicitudes con temporizador posible (pendientes o reenviadas).
  openRequests(): RequestRecord[] {
    return this.db
      .query(`SELECT ${REQUEST_COLS} FROM requests WHERE status IN ('pending', 'forwarded') ORDER BY created_at`)
      .all() as RequestRecord[];
  }

  // Solicitudes sin cerrar (pending o forwarded) para $memberId (dir "to") o suyas (dir "from").
  openFor(memberId: string, dir: "to" | "from"): RequestRecord[] {
    const col = dir === "to" ? "to_member" : "from_member";
    return this.db
      .query(`SELECT ${REQUEST_COLS} FROM requests WHERE ${col} = $memberId AND status IN ('pending', 'forwarded') ORDER BY created_at`)
      .all({ memberId }) as RequestRecord[];
  }

  forwardedVia(sessionId: string): RequestRecord[] {
    return this.db
      .query(`SELECT ${REQUEST_COLS} FROM requests WHERE status = 'forwarded' AND forwarded_session = $sessionId`)
      .all({ sessionId }) as RequestRecord[];
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

  // ---- conversaciones -------------------------------------------------------

  // Página de la conversación entre $a y $b (de la más nueva a la más vieja). Si el corte de la página cae en
  // medio de varias solicitudes con el mismo createdAt, se dejan todas para la siguiente (o, si la página
  // entera es ese empate, se devuelven todas juntas): con before = createdAt no se pierde ninguna.
  conversationPage(a: string, b: string, before: number | undefined, limit: number): { requests: RequestRecord[]; nextBefore?: number } {
    const rows = this.db
      .query(
        `SELECT ${REQUEST_COLS} FROM requests WHERE ${PAIR} AND ($before IS NULL OR created_at < $before)
         ORDER BY created_at DESC, id DESC LIMIT $n`,
      )
      .all({ a, b, before: before ?? null, n: limit + 1 }) as RequestRecord[];
    if (rows.length <= limit) return { requests: rows };
    const cut = rows[limit]!.createdAt;
    let page = rows.slice(0, limit).filter((r) => r.createdAt > cut);
    if (page.length > 0) return { requests: page, nextBefore: page.at(-1)!.createdAt };
    page = this.db
      .query(`SELECT ${REQUEST_COLS} FROM requests WHERE ${PAIR} AND created_at = $cut ORDER BY id DESC`)
      .all({ a, b, cut }) as RequestRecord[];
    const older = this.db.query(`SELECT 1 FROM requests WHERE ${PAIR} AND created_at < $cut LIMIT 1`).get({ a, b, cut });
    return older ? { requests: page, nextBefore: cut } : { requests: page };
  }

  // Lo último que pasó entre $a y $b: un mensaje (al enviarse) o una respuesta (al llegar).
  lastActivity(a: string, b: string): LastActivity | null {
    return this.db
      .query(
        `SELECT at, text, byMemberId FROM (
           SELECT sent_at AS at, message AS text, from_member AS byMemberId, 0 AS k, created_at FROM requests WHERE ${PAIR}
           UNION ALL
           SELECT responded_at, COALESCE(outcome_text, $accepted), to_member, 1, created_at FROM requests
           WHERE ${PAIR} AND responded_at IS NOT NULL
         ) ORDER BY at DESC, k DESC, created_at DESC LIMIT 1`,
      )
      .get({ a, b, accepted: ACCEPTED_PREVIEW }) as LastActivity | null;
  }

  // Cuántas cosas con $peer esperan una acción de $me: solicitudes suyas pendientes, respuestas o plazos
  // vencidos de las mías, y borradores míos esperando autorización dirigidos a $peer.
  waitingOn(me: string, peer: string): number {
    const row = this.db
      .query(
        `SELECT
           (SELECT COUNT(*) FROM requests WHERE to_member = $me AND from_member = $peer AND status = 'pending')
         + (SELECT COUNT(*) FROM requests WHERE from_member = $me AND to_member = $peer
              AND status IN ('accepted', 'rejected', 'answered', 'timed_out'))
         + (SELECT COUNT(*) FROM drafts WHERE author_member = $me AND status = 'awaiting' AND kind = 'request' AND to_member = $peer)
         + (SELECT COUNT(*) FROM drafts d JOIN requests r ON r.id = d.request_id
              WHERE d.author_member = $me AND d.status = 'awaiting' AND d.kind = 'response' AND r.from_member = $peer) AS n`,
      )
      .get({ me, peer }) as { n: number };
    return row.n;
  }
}
