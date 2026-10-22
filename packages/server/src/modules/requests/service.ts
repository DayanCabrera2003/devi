import { createHash } from "node:crypto";
import type {
  API, Approval, AuditAction, AuditTarget, CreateDraftMeta, CreateDraftResult, DeviRequest, Draft, Perm, RequestContext, SendFromAppMeta, Session,
  SessionDelivery, TakeRequestResult, UserEvent,
} from "@devi/protocol";
import { hasContext } from "@devi/protocol";
import type { z } from "zod";
import type { Access } from "../../core/auth";
import { HttpError } from "../../core/http";
import type { ModuleContext } from "../../core/module";
import { deliverToSession, pushUser } from "../../core/push";
import type { AuditDetails } from "../../core/services";
import {
  authorizedContent, type DiscardReason, discardedContent, escalationContent, handoffContent, noticeContent, requestContent, responseContent,
} from "./content";
import { injectionIn } from "./injection";
import type { DraftRecord, RequestRecord, RequestsStore } from "./store";
import { KeyedTimers } from "./timers";

type DraftMeta = z.output<typeof CreateDraftMeta>;

const draftKey = (id: string) => `draft:${id}`;
const requestKey = (id: string) => `request:${id}`;
const escalationKey = (id: string) => `escalation:${id}`;
const RESPONSE_OPEN = ["accepted", "rejected", "answered"] as const;
const isResponseOpen = (s: RequestRecord["status"]) => (RESPONSE_OPEN as readonly string[]).includes(s);

// meta.files de las entregas: JSON de [{id, name}]. El MCP descarga los archivos y da rutas locales al agente.
const filesMeta = (files: { id: string; name: string }[]) => JSON.stringify(files.map((f) => ({ id: f.id, name: f.name })));
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
// Solo se añade la clave si hay contexto: las vistas sin él no cambian.
const withContext = (context: RequestContext | undefined) => (context ? { context } : {});
const conflict = (message: string) => new HttpError(409, message, { code: "conflict" });
const sessionGone = () => new HttpError(409, "esa sesión ya no está abierta", { code: "session_gone" });
const chatUnavailable = () =>
  new HttpError(403, "La aprobación en el chat no está disponible (desactivada en el equipo o Claude Code no apto): hazlo desde la app de Devi", {
    code: "chat_approval_unavailable",
  });

// Ciclo de vida de borradores y solicitudes (diagrama de estados en docs/arquitectura.md).
// Todo se persiste en SQLite; los temporizadores viven en memoria y se reprograman en restore().
export class RequestsManager {
  private timers: KeyedTimers;

  constructor(
    private store: RequestsStore,
    private ctx: ModuleContext,
  ) {
    this.timers = new KeyedTimers(ctx.timers, ctx.now);
  }

  private get team() {
    return this.ctx.services.get("team");
  }
  private get sessions() {
    return this.ctx.services.get("sessions");
  }
  private get files() {
    return this.ctx.services.get("files");
  }
  private get settings() {
    return this.ctx.services.get("settings").get();
  }

  // ---- borradores -----------------------------------------------------------

  // Lo que el agente quiere enviar (solicitud o respuesta) queda en borrador hasta que su humano lo autoriza.
  // Con approval "chat" (el humano ya lo aprobó en el aviso de permisos de Claude Code) y el ajuste
  // chatApproval activo, se crea y se envía en la misma transacción: mismos efectos que autorizarlo en la app.
  async createDraft(access: Access, meta: DraftMeta, rawFiles: File[]): Promise<CreateDraftResult> {
    const session = this.sessions.get(meta.sessionId);
    if (!session || session.memberId !== access.memberId) {
      throw new HttpError(400, "la sesión de origen no existe o no es tuya", { code: "invalid" });
    }
    if (rawFiles.length > 0 && !access.perms.has("files.send")) {
      throw new HttpError(403, 'Te falta el permiso "files.send"', { code: "missing_perm", perm: "files.send" });
    }
    const peer = meta.kind === "request" ? this.recipientFor(access, meta.to) : this.forwardedTo(access, meta.requestId).fromMemberId;
    const valid = await this.files.validate(rawFiles);
    // Tras el await, la solicitud pudo cambiar: se vuelve a comprobar.
    const request = meta.kind === "response" ? this.forwardedTo(access, meta.requestId) : null;
    const chat = meta.approval === "chat" && this.settings.chatApproval;
    const context = meta.kind === "request" && hasContext(meta.context) ? meta.context : undefined;

    const previous = request ? this.store.awaitingResponseDraft(request.id) : null;
    const now = this.ctx.now();
    const d: DraftRecord = {
      id: crypto.randomUUID(), kind: meta.kind, authorMemberId: access.memberId, authorSessionId: session.id,
      authorSessionName: session.name, toMemberId: meta.kind === "request" ? peer : null, requestId: request?.id ?? null,
      message: meta.message.trim(), status: chat ? "authorized" : "awaiting", createdAt: now, expiresAt: now + this.settings.draftTtlMs,
      shareWithTeam: meta.kind === "response" && meta.shareWithTeam,
      requestKind: meta.kind === "request" ? meta.requestKind : "request",
    };
    // Aprobado en el chat: la solicitud nueva o la respuesta aplicada, preparadas para la misma transacción.
    const sentRequest: RequestRecord | null = !chat
      ? null
      : request
        ? { ...request, status: "answered", outcome: "answered", outcomeText: d.message }
        : {
            id: this.newRequestId(), fromMemberId: d.authorMemberId, fromSessionId: d.authorSessionId,
            fromSessionName: d.authorSessionName, toMemberId: peer, message: d.message, status: "pending",
            forwardedSessionId: null, outcome: null, outcomeText: null, createdAt: now, sentAt: now,
            deadline: now + this.settings.requestTimeoutMs, kind: d.requestKind,
          };
    // Atómico: primero los bytes a disco; luego, en una sola transacción, se descarta el borrador anterior y se
    // insertan el borrador y sus archivos (y, aprobado en el chat, la solicitud o la respuesta); solo tras el
    // commit hay temporizadores y eventos. Si algo falla, se borra lo escrito y no cambia nada más.
    const written = this.files.write(valid);
    let previousStaged: SessionDelivery | null = null;
    try {
      this.store.transaction(() => {
        if (previous) {
          this.store.setDraftStatus(previous.id, "discarded");
          previousStaged = this.stageForAuthor(previous, this.discardedDelivery(previous, "replaced"));
        }
        this.store.insertDraft(d);
        this.store.setDraftContext(d.id, context);
        this.files.record({ draftId: d.id, direction: d.kind, authorMemberId: access.memberId, peerMemberId: peer, written });
        if (sentRequest) {
          if (request) this.store.saveRequest(sentRequest);
          else {
            this.store.insertRequest(sentRequest);
            this.store.setRequestContext(sentRequest.id, context);
          }
          this.files.attachToRequest(d.id, sentRequest.id);
        }
      });
    } catch (e) {
      this.files.removeWritten(written);
      throw e;
    }
    if (previous) {
      this.audit("draft.discarded", access.memberId, "draft", previous.id, { reason: "replaced" });
      this.afterDiscard(previous, "replaced", previousStaged);
    }
    const details = {
      kind: d.kind, to: peer, toName: this.team.nameOf(peer), requestId: sentRequest?.id ?? d.requestId, sessionId: session.id,
      sessionName: session.name, messageSha256: sha256(d.message),
      files: JSON.stringify(valid.map((f) => ({ name: f.name, size: f.size }))),
      ...(d.requestKind === "handoff" ? { requestKind: "handoff" } : {}),
    };
    if (sentRequest) {
      this.audit("draft.approved_in_chat", access.memberId, "draft", d.id, {
        ...details, from: access.memberId, fromName: this.team.nameOf(access.memberId),
      });
      return { ...this.draftView(d), approval: "chat", sent: this.afterSent(access, sentRequest, d) };
    }
    this.audit("draft.created", access.memberId, "draft", d.id, details);
    if (request) this.timers.cancel(requestKey(request.id)); // el plazo se pausa mientras haya borrador de respuesta
    this.timers.at(draftKey(d.id), d.expiresAt, () => this.expire(d.id));
    const view = this.draftView(d);
    this.push(access.memberId, { type: "draft.awaiting", draft: view });
    return { ...view, approval: "app" };
  }

  // Efectos tras el commit de algo aprobado en el chat (los mismos que authorize): plazos y avisos a las apps.
  // A la sesión autora no se le manda draft_authorized: el resultado de la herramienta ya se lo dice.
  private afterSent(access: Access, r: RequestRecord, d: DraftRecord): NonNullable<CreateDraftResult["sent"]> {
    const view = this.requestView(r);
    if (r.status === "pending") {
      this.schedule(r);
      this.incoming(r, view);
      this.push(r.fromMemberId, { type: "request.updated", request: view });
      return { requestId: r.id, toName: this.team.nameOf(r.toMemberId), sentAt: r.sentAt, deadline: r.deadline };
    }
    this.timers.cancel(requestKey(r.id));
    this.audit("request.answered", access.memberId, "request", r.id, { draftId: d.id, to: r.fromMemberId });
    this.push(r.fromMemberId, { type: "response.incoming", request: view });
    this.push(r.fromMemberId, { type: "request.updated", request: view });
    this.push(r.toMemberId, { type: "request.updated", request: view });
    if (d.shareWithTeam) this.share(r);
    return { requestId: r.id, toName: this.team.nameOf(r.fromMemberId), sentAt: this.ctx.now() };
  }

  authorize(access: Access, id: string): Draft {
    const d = this.authoredAwaiting(access, id);
    // Los permisos pudieron revocarse desde que se creó el borrador: valen los de ahora.
    const needs: Perm[] = ["requests.send", ...(this.files.forDraft(d.id).length > 0 ? (["files.send"] as const) : [])];
    for (const perm of needs) {
      if (!access.perms.has(perm)) throw new HttpError(403, `Te falta el permiso "${perm}"`, { code: "missing_perm", perm });
    }
    const now = this.ctx.now();
    if (d.kind === "request") {
      const to = this.team.member(d.toMemberId!);
      if (!to || to.disabled) throw conflict(`${this.team.nameOf(d.toMemberId!)} ya no está en el equipo`);
      const r: RequestRecord = {
        id: this.newRequestId(), fromMemberId: d.authorMemberId, fromSessionId: d.authorSessionId,
        fromSessionName: d.authorSessionName, toMemberId: to.id, message: d.message, status: "pending",
        forwardedSessionId: null, outcome: null, outcomeText: null, createdAt: now, sentAt: now,
        deadline: now + this.settings.requestTimeoutMs, kind: d.requestKind ?? "request",
      };
      let staged: SessionDelivery | null = null;
      this.store.transaction(() => {
        this.store.insertRequest(r);
        this.store.setRequestContext(r.id, this.store.draftContext(d.id));
        this.store.setDraftStatus(d.id, "authorized");
        this.files.attachToRequest(d.id, r.id);
        staged = this.stageForAuthor(d, {
          kind: "draft_authorized",
          content: authorizedContent({ kind: "request", toName: to.name, requestId: r.id }),
          meta: { draft_id: d.id, request_id: r.id },
        });
      });
      this.timers.cancel(draftKey(d.id));
      this.audit("draft.authorized", access.memberId, "draft", d.id, { kind: "request", to: to.id, requestId: r.id });
      this.schedule(r);
      const view = this.requestView(r);
      this.incoming(r, view);
      this.push(r.fromMemberId, { type: "request.updated", request: view });
      this.sendStaged(d, staged);
    } else {
      const r = this.requestOr404(d.requestId!);
      if (r.status !== "forwarded") throw conflict(`la solicitud ya está ${r.status}`);
      r.status = "answered";
      r.outcome = "answered";
      r.outcomeText = d.message;
      let staged: SessionDelivery | null = null;
      this.store.transaction(() => {
        this.store.saveRequest(r);
        this.store.setDraftStatus(d.id, "authorized");
        this.files.attachToRequest(d.id, r.id);
        staged = this.stageForAuthor(d, {
          kind: "draft_authorized",
          content: authorizedContent({ kind: "response", fromName: this.team.nameOf(r.fromMemberId), requestId: r.id }),
          meta: { draft_id: d.id, request_id: r.id },
        });
      });
      this.timers.cancel(draftKey(d.id));
      this.timers.cancel(requestKey(r.id));
      this.audit("draft.authorized", access.memberId, "draft", d.id, { kind: "response", requestId: r.id });
      this.audit("request.answered", access.memberId, "request", r.id, { draftId: d.id, to: r.fromMemberId });
      const view = this.requestView(r);
      this.push(r.fromMemberId, { type: "response.incoming", request: view });
      this.push(r.fromMemberId, { type: "request.updated", request: view });
      this.push(r.toMemberId, { type: "request.updated", request: view });
      this.sendStaged(d, staged);
      if (d.shareWithTeam) this.share(r);
    }
    return this.draftView(this.store.getDraft(d.id)!);
  }

  discardByAuthor(access: Access, id: string): Draft {
    const d = this.authoredAwaiting(access, id);
    this.discard(d, "discarded");
    this.audit("draft.discarded", access.memberId, "draft", d.id, { kind: d.kind, reason: "discarded" });
    return this.draftView(this.store.getDraft(d.id)!);
  }

  // Temporizador del borrador (15 min por defecto).
  private expire(id: string): void {
    const d = this.store.getDraft(id);
    if (!d || d.status !== "awaiting") return;
    if (this.ctx.now() < d.expiresAt) return this.timers.at(draftKey(id), d.expiresAt, () => this.expire(id));
    this.discard(d, "expired");
  }

  private discard(d: DraftRecord, reason: DiscardReason): void {
    let staged: SessionDelivery | null = null;
    this.store.transaction(() => {
      this.store.setDraftStatus(d.id, "discarded");
      staged = this.stageForAuthor(d, this.discardedDelivery(d, reason));
    });
    // Caducado (también al arrancar, en restore): lo hace el servidor.
    if (reason === "expired") this.audit("draft.expired", null, "draft", d.id, { kind: d.kind, author: d.authorMemberId });
    this.afterDiscard(d, reason, staged);
  }

  private discardedDelivery(d: DraftRecord, reason: DiscardReason): SessionDelivery {
    const target =
      d.kind === "request"
        ? ({ kind: "request", toName: this.team.nameOf(d.toMemberId!) } as const)
        : ({ kind: "response", requestId: d.requestId! } as const);
    return {
      kind: "draft_discarded",
      content: discardedContent(target, reason, Math.round(this.settings.draftTtlMs / 60_000)),
      meta: { draft_id: d.id, reason, ...(d.requestId ? { request_id: d.requestId } : {}) },
    };
  }

  // Efectos de un borrador ya descartado en la BD (temporizadores, avisos, plazo de la solicitud).
  // `staged`: el aviso draft_discarded ya guardado en la bandeja de la sesión autora (o null si no existe).
  private afterDiscard(d: DraftRecord, reason: DiscardReason, staged: SessionDelivery | null): void {
    this.timers.cancel(draftKey(d.id));
    this.push(d.authorMemberId, { type: "draft.discarded", draftId: d.id });
    this.sendStaged(d, staged);
    this.ctx.bus.emit("draft.discarded", { draftId: d.id });
    // Respuesta descartada o caducada: la solicitud sigue en forwarded con un plazo nuevo completo.
    // Si se sustituye, el borrador nuevo vuelve a pausarlo enseguida.
    if (d.kind === "response" && reason !== "replaced") {
      const r = this.store.getRequest(d.requestId!);
      if (r && r.status === "forwarded") {
        r.deadline = this.ctx.now() + this.settings.requestTimeoutMs;
        this.store.saveRequest(r);
        this.schedule(r);
        this.pushBoth(r, "request.updated");
      }
    }
  }

  // ---- enviar desde la app --------------------------------------------------

  // La persona escribe la solicitud en la app: no hay agente ni borrador que autorizar, sale ya pending.
  // Al destinatario le llega igual que una solicitud autorizada (request.incoming, plazo, timeout).
  async sendFromApp(access: Access, meta: z.output<typeof SendFromAppMeta>, rawFiles: File[]): Promise<DeviRequest> {
    if (rawFiles.length > 0 && !access.perms.has("files.send")) {
      throw new HttpError(403, 'Te falta el permiso "files.send"', { code: "missing_perm", perm: "files.send" });
    }
    const to = this.recipientFor(access, meta.to);
    const valid = await this.files.validate(rawFiles);
    // Tras el await, el destinatario pudo desactivarse: se vuelve a comprobar.
    this.recipientFor(access, to);
    const now = this.ctx.now();
    const r: RequestRecord = {
      id: this.newRequestId(), origin: "app", fromMemberId: access.memberId, fromSessionId: "", fromSessionName: "",
      toMemberId: to, message: meta.message.trim(), status: "pending", forwardedSessionId: null, outcome: null,
      outcomeText: null, createdAt: now, sentAt: now, deadline: now + this.settings.requestTimeoutMs,
    };
    // Igual que al crear un borrador: bytes a disco y después filas en una transacción; si falla, se borra lo escrito.
    const written = this.files.write(valid);
    try {
      this.store.transaction(() => {
        this.store.insertRequest(r);
        this.files.recordForRequest({ requestId: r.id, direction: "request", authorMemberId: access.memberId, peerMemberId: to, written });
      });
    } catch (e) {
      this.files.removeWritten(written);
      throw e;
    }
    this.audit("request.sent_from_app", access.memberId, "request", r.id, {
      to, toName: this.team.nameOf(to), messageSha256: sha256(r.message),
      files: JSON.stringify(valid.map((f) => ({ name: f.name, size: f.size }))),
    });
    this.schedule(r);
    const view = this.requestView(r);
    this.incoming(r, view);
    this.push(r.fromMemberId, { type: "request.updated", request: view });
    return view;
  }

  // Para las conversaciones: misma vista que viaja por SSE.
  viewOf(r: RequestRecord): DeviRequest {
    return this.requestView(r);
  }

  draftViewOf(d: DraftRecord): Draft {
    return this.draftView(d);
  }

  // ---- acciones de B (destinatario) -----------------------------------------

  forward(access: Access, id: string, sessionId: string): DeviRequest {
    const r = this.received(access, id);
    if (r.status !== "pending") throw conflict(`la solicitud ya está ${r.status}`);
    const s = this.sessions.get(sessionId);
    if (!s || s.memberId !== r.toMemberId || !this.sessions.isAlive(s.id)) throw sessionGone();
    const delivery = this.requestDelivery(r);
    // Bandeja + estado en una transacción. Si la sesión se cerró justo ahora (no hay stream), se deshace todo:
    // la solicitud sigue pendiente y la app avisa.
    this.store.transaction(() => {
      const staged = this.sessions.enqueue(s.id, delivery);
      r.status = "forwarded";
      r.forwardedSessionId = s.id;
      this.store.saveRequest(r);
      if (!this.deliver(s.id, staged)) throw sessionGone();
    });
    this.audit("request.forwarded", access.memberId, "request", r.id, { sessionId: s.id, sessionName: s.name });
    return this.pushBoth(r, "request.updated");
  }

  // La entrega de una solicitud a una sesión (reenvío desde la app o traída desde el chat).
  private requestDelivery(r: RequestRecord): SessionDelivery {
    const files = this.files.forRequest(r.id).files;
    const handoff = r.kind === "handoff";
    const what = { id: r.id, fromName: this.team.nameOf(r.fromMemberId), fromSessionName: r.fromSessionName, message: r.message, files };
    return {
      kind: "request",
      content: handoff ? handoffContent(what) : requestContent({ ...what, origin: r.origin, context: this.store.requestContext(r.id) }),
      meta: {
        request_id: r.id, from: r.fromMemberId, from_name: this.team.nameOf(r.fromMemberId),
        from_session: r.fromSessionName, files: filesMeta(files),
        ...(handoff ? { request_kind: "handoff" } : {}),
      },
    };
  }

  accept(access: Access, id: string, note: string | undefined, shareWithTeam = false): DeviRequest {
    const r = this.received(access, id);
    if (r.status !== "pending") throw conflict(`la solicitud ya está ${r.status}`);
    r.status = r.outcome = "accepted";
    r.outcomeText = note?.trim() || null;
    this.audit("request.accepted", access.memberId, "request", r.id, { from: r.fromMemberId });
    const view = this.answer(r);
    if (shareWithTeam) this.share(r);
    return view;
  }

  reject(access: Access, id: string, reason: string): DeviRequest {
    const r = this.received(access, id);
    if (!reason.trim()) throw new HttpError(400, "el rechazo necesita un motivo", { code: "invalid" });
    if (r.status !== "pending") throw conflict(`la solicitud ya está ${r.status}`);
    r.status = r.outcome = "rejected";
    r.outcomeText = reason.trim();
    this.audit("request.rejected", access.memberId, "request", r.id, { from: r.fromMemberId, reasonSha256: sha256(r.outcomeText) });
    return this.answer(r);
  }

  // ---- B atiende desde Claude Code (take_request / decline_request) ----------

  // Mismo mecanismo que los envíos aprobados en el chat: el MCP manda approval "chat" solo si su cliente es un
  // Claude Code que muestra el aviso de permisos en cada llamada, y el equipo tiene activado chatApproval.
  // Además, la sesión que llama tiene que ser de quien recibe la solicitud y estar viva.
  private chatSession(access: Access, sessionId: string, approval: Approval): Session {
    if (approval !== "chat" || !this.settings.chatApproval) throw chatUnavailable();
    const s = this.sessions.get(sessionId);
    if (!s || s.memberId !== access.memberId || !this.sessions.isAlive(s.id)) throw sessionGone();
    return s;
  }

  // Como «Enviar a mi sesión» en la app, con destino la sesión que llama. La entrega va en la respuesta (el MCP la
  // devuelve como resultado de la herramienta y confirma su entrada de la bandeja); no se empuja por el canal para
  // no repetirla. Con una posible prompt injection no se trae: hay que revisarla en la app.
  take(access: Access, id: string, body: { sessionId: string; approval: Approval }): TakeRequestResult {
    const r = this.received(access, id);
    const s = this.chatSession(access, body.sessionId, body.approval);
    if (r.status !== "pending") throw conflict(`la solicitud ya está ${r.status}`);
    const scan = injectionIn(r.message, this.store.requestContext(r.id), this.files.readForCopy(r.id));
    if (scan.level !== "none") {
      throw new HttpError(409, `Posible prompt injection (${scan.reasons.join("; ")}): revísala en la app de Devi`, { code: "injection" });
    }
    let delivery: SessionDelivery | null = null;
    this.store.transaction(() => {
      delivery = this.sessions.enqueue(s.id, this.requestDelivery(r));
      r.status = "forwarded";
      r.forwardedSessionId = s.id;
      this.store.saveRequest(r);
    });
    this.audit("request.taken_in_chat", access.memberId, "request", r.id, { sessionId: s.id, sessionName: s.name, from: r.fromMemberId });
    return { request: this.pushBoth(r, "request.updated"), delivery: delivery! };
  }

  // Como Rechazar en la app (motivo obligatorio), con las mismas condiciones que take.
  decline(access: Access, id: string, body: { sessionId: string; reason: string; approval: Approval }): DeviRequest {
    const r = this.received(access, id);
    const s = this.chatSession(access, body.sessionId, body.approval);
    if (!body.reason.trim()) throw new HttpError(400, "el rechazo necesita un motivo", { code: "invalid" });
    if (r.status !== "pending") throw conflict(`la solicitud ya está ${r.status}`);
    r.status = r.outcome = "rejected";
    r.outcomeText = body.reason.trim();
    this.audit("request.declined_in_chat", access.memberId, "request", r.id, {
      from: r.fromMemberId, reasonSha256: sha256(r.outcomeText), sessionId: s.id, sessionName: s.name,
    });
    return this.answer(r);
  }

  // ---- acciones de A (remitente) --------------------------------------------

  acceptResponse(access: Access, id: string): DeviRequest {
    const r = this.sent(access, id);
    if (!isResponseOpen(r.status)) throw conflict(`no hay respuesta abierta (estado: ${r.status})`);
    this.audit("response.accepted", access.memberId, "request", r.id, { outcome: r.outcome });
    return this.close(r);
  }

  forwardResponse(access: Access, id: string, sessionId: string): DeviRequest {
    const r = this.sent(access, id);
    if (!isResponseOpen(r.status)) throw conflict(`no hay respuesta abierta (estado: ${r.status})`);
    const s = this.sessions.get(sessionId);
    if (!s || s.memberId !== r.fromMemberId || !this.sessions.isAlive(s.id)) throw sessionGone();
    const files = this.files.forRequest(r.id).responseFiles;
    const delivery: SessionDelivery = {
      kind: "response",
      content: responseContent({
        toName: this.team.nameOf(r.toMemberId), message: r.message, outcome: r.outcome!, outcomeText: r.outcomeText, files,
      }),
      meta: { request_id: r.id, from: r.toMemberId, outcome: r.outcome ?? "", files: filesMeta(files) },
    };
    this.store.transaction(() => {
      if (!this.deliver(s.id, this.sessions.enqueue(s.id, delivery))) throw sessionGone();
      r.status = "closed";
      this.store.saveRequest(r);
    });
    this.audit("response.forwarded", access.memberId, "request", r.id, { sessionId: s.id, sessionName: s.name, outcome: r.outcome });
    return this.close(r);
  }

  resend(access: Access, id: string): DeviRequest {
    const r = this.sent(access, id);
    if (r.status !== "timed_out") throw conflict(`la solicitud está ${r.status}`);
    const to = this.team.member(r.toMemberId);
    if (!to || to.disabled) throw conflict(`${this.team.nameOf(r.toMemberId)} ya no está en el equipo`);
    const now = this.ctx.now();
    r.status = "pending";
    r.forwardedSessionId = null;
    r.sentAt = now;
    r.deadline = now + this.settings.requestTimeoutMs;
    this.store.saveRequest(r);
    this.schedule(r);
    this.audit("request.resent", access.memberId, "request", r.id, { to: r.toMemberId });
    this.incoming(r, this.requestView(r));
    return this.pushBoth(r, "request.updated");
  }

  ignore(access: Access, id: string): DeviRequest {
    const r = this.sent(access, id);
    if (r.status !== "timed_out") throw conflict(`la solicitud está ${r.status}`);
    this.audit("request.ignored", access.memberId, "request", r.id, { to: r.toMemberId });
    return this.close(r);
  }

  // Pedírselo a otra persona (pending o timed_out): solicitud nueva para `to` con el mismo mensaje, origen y
  // archivos (copiados: los de la original se liberan al cerrarla), y la original queda closed con una nota.
  // Lo decide una persona en la app; el servidor nunca elige a quién.
  reassign(access: Access, id: string, to: string): { request: DeviRequest; original: DeviRequest } {
    const r = this.sent(access, id);
    if (r.status !== "pending" && r.status !== "timed_out") throw conflict(`la solicitud ya está ${r.status}`);
    const toId = this.recipientFor(access, to);
    if (toId === r.toMemberId) throw new HttpError(400, `la solicitud ya es para ${this.team.nameOf(toId)}`, { code: "invalid" });
    if (this.files.forRequest(r.id).files.length > 0 && !access.perms.has("files.send")) {
      throw new HttpError(403, 'Te falta el permiso "files.send"', { code: "missing_perm", perm: "files.send" });
    }
    const now = this.ctx.now();
    const next: RequestRecord = {
      ...r, id: this.newRequestId(), toMemberId: toId, status: "pending", forwardedSessionId: null, outcome: null,
      outcomeText: null, createdAt: now, sentAt: now, deadline: now + this.settings.requestTimeoutMs,
      escalatedAt: null, closedNote: null, replacedBy: null,
    };
    const toName = this.team.nameOf(toId);
    const written = this.files.write(this.files.readForCopy(r.id));
    try {
      this.store.transaction(() => {
        this.store.insertRequest(next);
        // El contexto va en su propia columna: se copia aparte del registro.
        this.store.setRequestContext(next.id, this.store.requestContext(r.id));
        this.files.recordForRequest({ requestId: next.id, direction: "request", authorMemberId: r.fromMemberId, peerMemberId: toId, written });
        r.status = "closed";
        r.closedNote = `Reenviada a ${toName}`;
        r.replacedBy = next.id;
        this.store.saveRequest(r);
      });
    } catch (e) {
      this.files.removeWritten(written);
      throw e;
    }
    this.audit("request.reassigned", access.memberId, "request", r.id, { from: r.toMemberId, to: toId, toName, requestId: next.id });
    this.schedule(next);
    const view = this.requestView(next);
    this.incoming(next, view);
    this.push(r.fromMemberId, { type: "request.updated", request: view });
    return { request: view, original: this.close(r) };
  }

  // ---- tiempo ---------------------------------------------------------------

  // Nadie actuó a tiempo. En pausa mientras haya un borrador de respuesta esperando.
  private onDeadline(id: string): void {
    const r = this.store.getRequest(id);
    if (!r || (r.status !== "pending" && r.status !== "forwarded")) return;
    if (this.store.awaitingResponseDraft(id)) return;
    if (this.ctx.now() < r.deadline) return this.schedule(r);
    r.status = "timed_out";
    this.store.saveRequest(r);
    this.audit("request.timed_out", null, "request", r.id, { from: r.fromMemberId, to: r.toMemberId });
    const view = this.requestView(r);
    this.push(r.fromMemberId, { type: "request.timed_out", request: view });
    this.push(r.toMemberId, { type: "request.updated", request: view });
  }

  private schedule(r: RequestRecord): void {
    this.timers.at(requestKey(r.id), r.deadline, () => this.onDeadline(r.id));
    this.scheduleEscalation(r);
  }

  // ---- escalado ---------------------------------------------------------------

  // Cuándo toca avisar al autor: sentAt + escalateAfterMs, si está activado y cae antes del timeout.
  private escalationDue(r: RequestRecord): number | null {
    const after = this.settings.escalateAfterMs;
    if (after === null || r.status !== "pending" || r.escalatedAt != null) return null;
    const due = r.sentAt + after;
    return due < r.deadline ? due : null;
  }

  // Si ya venció (p. ej. el servidor estuvo apagado), avisa ahora mismo; si no, programa el aviso.
  private scheduleEscalation(r: RequestRecord): void {
    const due = this.escalationDue(r);
    if (due === null) return;
    if (due <= this.ctx.now()) this.onEscalate(r.id);
    else this.timers.at(escalationKey(r.id), due, () => this.onEscalate(r.id));
  }

  // Sigue pending (nadie la aceptó, rechazó ni envió a una sesión): aviso a la sesión autora (si existe; queda en
  // su bandeja para los hooks) y evento a su app. markEscalated garantiza que sea una sola vez por solicitud.
  private onEscalate(id: string): void {
    this.timers.cancel(escalationKey(id));
    const r = this.store.getRequest(id);
    if (!r) return;
    const due = this.escalationDue(r);
    if (due === null) return;
    const now = this.ctx.now();
    if (now < due) return void this.timers.at(escalationKey(id), due, () => this.onEscalate(id));
    const toName = this.team.nameOf(r.toMemberId);
    const delivery: SessionDelivery = {
      kind: "escalation",
      content: escalationContent({ id: r.id, toName, minutes: Math.round((now - r.sentAt) / 60_000), message: r.message }),
      meta: { request_id: r.id, to: r.toMemberId, to_name: toName },
    };
    const sessionId = r.origin === "app" ? "" : r.fromSessionId;
    let staged: SessionDelivery | null = null;
    let marked = false;
    this.store.transaction(() => {
      marked = this.store.markEscalated(r.id, now);
      if (marked && sessionId && this.sessions.get(sessionId)) staged = this.sessions.enqueue(sessionId, delivery);
    });
    if (!marked) return;
    r.escalatedAt = now;
    this.audit("request.escalated", null, "request", r.id, { from: r.fromMemberId, to: r.toMemberId });
    if (staged) this.deliver(sessionId, staged);
    this.push(r.fromMemberId, { type: "request.escalated", request: this.requestView(r) });
  }

  // Al arrancar: caduca o reprograma borradores y reprograma (o vence) plazos.
  restore(): void {
    for (const d of this.store.awaitingDrafts()) {
      if (d.expiresAt <= this.ctx.now()) this.discard(d, "expired");
      else this.timers.at(draftKey(d.id), d.expiresAt, () => this.expire(d.id));
    }
    for (const r of this.store.openRequests()) {
      if (this.store.awaitingResponseDraft(r.id)) continue;
      if (r.deadline <= this.ctx.now()) this.onDeadline(r.id);
      else this.schedule(r);
    }
  }

  // La sesión a la que se reenvió desapareció (cerrada, sustituida u obsoleta): si nadie tiene un borrador de
  // respuesta esperando, la tarjeta vuelve a pending con plazo nuevo y B la vuelve a ver.
  onSessionClosed(sessionId: string): void {
    for (const r of this.store.forwardedVia(sessionId)) {
      if (this.store.awaitingResponseDraft(r.id)) continue;
      r.status = "pending";
      r.forwardedSessionId = null;
      r.deadline = this.ctx.now() + this.settings.requestTimeoutMs;
      this.store.saveRequest(r);
      this.schedule(r);
      this.ctx.log(`la sesión ${sessionId} desapareció: la solicitud ${r.id} vuelve a pending`);
      this.pushBoth(r, "request.updated");
    }
  }

  // ---- app y pruebas --------------------------------------------------------

  // Tarjetas abiertas de una persona: se reenvían cada vez que su app (re)conecta.
  openCards(memberId: string): UserEvent[] {
    const out: UserEvent[] = this.store.awaitingDraftsBy(memberId).map((d) => ({ type: "draft.awaiting", draft: this.draftView(d) }));
    for (const r of this.store.cardsFor(memberId)) {
      const request = this.requestView(r);
      if (r.toMemberId === memberId && r.status === "pending") out.push({ type: "request.incoming", request });
      else if (r.status === "timed_out") out.push({ type: "request.timed_out", request });
      else out.push({ type: "response.incoming", request });
    }
    return out;
  }

  // Solo para pruebas (la ruta solo existe en modo dev): mensaje "debug" a una sesión o a las sesiones vivas de una persona.
  debugPush(access: Access, body: z.output<typeof API.debugPush.body>): number {
    const targets = body.sessionId ? [body.sessionId] : this.sessions.liveOf(body.memberId ?? access.memberId).map((s) => s.id);
    return targets.filter((id) => this.deliver(id, { kind: "debug", content: body.content, meta: {} })).length;
  }

  // ---- utilidades -----------------------------------------------------------

  // Le llega una solicitud nueva a B: tarjeta en su app y, si lo tiene activado (Ajustes), aviso en su sesión viva
  // más reciente (una sola, para no repetirlo) de las que declararon entender request_notice: un MCP antiguo
  // rechazaría la bandeja entera. Si ninguna lo entiende, basta la tarjeta. Sin canal, lo inyecta el hook.
  private incoming(r: RequestRecord, view: DeviRequest): void {
    this.push(r.toMemberId, { type: "request.incoming", request: view });
    if (this.ctx.services.find("prefs")?.of(r.toMemberId).sessionNotices === false) return;
    const target = this.sessions
      .liveOf(r.toMemberId)
      .filter((s) => this.sessions.supports(s.id, "request_notice"))
      .sort((a, b) => b.lastSeen - a.lastSeen)[0];
    if (!target) return;
    const context = this.store.requestContext(r.id);
    const delivery: SessionDelivery = {
      kind: "request_notice",
      content: noticeContent({
        id: r.id, fromName: this.team.nameOf(r.fromMemberId), fromSessionName: r.fromSessionName, message: r.message,
        files: view.files.length, origin: r.origin, handoff: r.kind === "handoff", injection: injectionIn(r.message, context).level !== "none",
      }),
      meta: {
        request_id: r.id, from: r.fromMemberId, from_name: this.team.nameOf(r.fromMemberId), from_session: r.fromSessionName,
        ...(r.kind === "handoff" ? { request_kind: "handoff" } : {}),
      },
    };
    this.deliver(target.id, this.sessions.enqueue(target.id, delivery));
  }

  private answer(r: RequestRecord): DeviRequest {
    this.store.saveRequest(r);
    this.timers.cancel(requestKey(r.id));
    const view = this.requestView(r);
    this.push(r.fromMemberId, { type: "response.incoming", request: view });
    return this.pushBoth(r, "request.updated");
  }

  // "Guardar en la base del equipo": se publica en el bus (knowledge lo indexa si no hay secretos).
  // Sin texto de respuesta (aceptada sin nota) no hay nada que guardar.
  private share(r: RequestRecord): void {
    if (!r.outcomeText) return;
    this.ctx.bus.emit("request.shared", {
      requestId: r.id, question: r.message, answer: r.outcomeText, askedBy: r.fromMemberId, answeredBy: r.toMemberId, answeredAt: this.ctx.now(),
    });
  }

  private close(r: RequestRecord): DeviRequest {
    r.status = "closed";
    this.store.saveRequest(r);
    this.timers.cancel(requestKey(r.id));
    this.ctx.bus.emit("request.closed", { requestId: r.id });
    return this.pushBoth(r, "request.updated");
  }

  private pushBoth(r: RequestRecord, type: "request.updated"): DeviRequest {
    const view = this.requestView(r);
    this.push(r.fromMemberId, { type, request: view });
    this.push(r.toMemberId, { type, request: view });
    return view;
  }

  private audit(action: AuditAction, actorMemberId: string | null, targetType: AuditTarget, targetId: string, details: AuditDetails = {}): void {
    this.ctx.services.find("audit")?.record({ actorMemberId, action, targetType, targetId, details });
  }

  private push(memberId: string, event: UserEvent): void {
    pushUser(this.ctx.sse, memberId, event);
    // Cada cambio de una solicitud (o de un borrador) entre dos personas avisa también de su conversación.
    const peer = this.conversationPeer(memberId, event);
    if (peer) pushUser(this.ctx.sse, memberId, { type: "conversation.updated", memberId: peer });
  }

  private conversationPeer(memberId: string, event: UserEvent): string | null {
    switch (event.type) {
      case "request.incoming":
      case "request.updated":
      case "response.incoming":
      case "request.timed_out":
      case "request.escalated": {
        const r = event.request;
        return r.fromMemberId === memberId ? r.toMemberId : r.fromMemberId;
      }
      case "draft.awaiting":
        return event.draft.kind === "request" ? event.draft.toMemberId : (this.store.getRequest(event.draft.requestId)?.fromMemberId ?? null);
      case "draft.discarded": {
        const d = this.store.getDraft(event.draftId);
        if (!d) return null;
        return d.kind === "request" ? d.toMemberId : (this.store.getRequest(d.requestId!)?.fromMemberId ?? null);
      }
      default:
        return null;
    }
  }

  // Aviso a la sesión del autor, solo si sigue existiendo (pudo cerrarse o ser sustituida). En dos pasos:
  // stageForAuthor lo guarda en su bandeja dentro de la transacción; sendStaged lo empuja tras el commit.
  private stageForAuthor(d: DraftRecord, delivery: SessionDelivery): SessionDelivery | null {
    return this.sessions.get(d.authorSessionId) ? this.sessions.enqueue(d.authorSessionId, delivery) : null;
  }

  private sendStaged(d: DraftRecord, staged: SessionDelivery | null): void {
    if (staged) this.deliver(d.authorSessionId, staged);
  }

  private deliver(sessionId: string, d: SessionDelivery): boolean {
    return deliverToSession(this.ctx.sse, sessionId, d);
  }

  private recipientFor(access: Access, to: string): string {
    const m = this.team.member(to);
    if (!m || m.disabled) throw new HttpError(404, `"${to}" no está en el equipo`, { code: "not_found" });
    if (m.id === access.memberId) throw new HttpError(400, "no puedes enviarte una solicitud a ti mismo", { code: "invalid" });
    return m.id;
  }

  // Para responder: la solicitud es para quien llama y está en forwarded.
  private forwardedTo(access: Access, requestId: string): RequestRecord {
    const r = this.received(access, requestId);
    if (r.status !== "forwarded") throw conflict(`la solicitud ya está ${r.status}`);
    return r;
  }

  private authoredAwaiting(access: Access, id: string): DraftRecord {
    const d = this.store.getDraft(id);
    if (!d) throw new HttpError(404, "borrador desconocido", { code: "not_found" });
    if (d.authorMemberId !== access.memberId) throw new HttpError(403, "este borrador no es tuyo", { code: "forbidden" });
    if (d.status !== "awaiting") throw conflict(`el borrador ya está ${d.status}`);
    return d;
  }

  private requestOr404(id: string): RequestRecord {
    const r = this.store.getRequest(id);
    if (!r) throw new HttpError(404, "solicitud desconocida", { code: "not_found" });
    return r;
  }

  private received(access: Access, id: string): RequestRecord {
    const r = this.requestOr404(id);
    if (r.toMemberId !== access.memberId) throw new HttpError(403, "esta solicitud no es para ti", { code: "forbidden" });
    return r;
  }

  private sent(access: Access, id: string): RequestRecord {
    const r = this.requestOr404(id);
    if (r.fromMemberId !== access.memberId) throw new HttpError(403, "esta solicitud no es tuya", { code: "forbidden" });
    return r;
  }

  // Ids cortos (el agente los repite en respond_to_request), sin colisiones.
  private newRequestId(): string {
    for (;;) {
      const id = crypto.randomUUID().slice(0, 8);
      if (!this.store.getRequest(id)) return id;
    }
  }

  private draftView(d: DraftRecord): Draft {
    const base = {
      id: d.id, authorMemberId: d.authorMemberId, authorSessionId: d.authorSessionId, message: d.message,
      status: d.status, files: this.files.forDraft(d.id), createdAt: d.createdAt, expiresAt: d.expiresAt,
      ...withContext(d.kind === "request" ? this.store.draftContext(d.id) : undefined),
    };
    return d.kind === "request"
      ? { ...base, kind: "request", toMemberId: d.toMemberId!, requestKind: d.requestKind ?? "request" }
      : { ...base, kind: "response", requestId: d.requestId!, ...(d.shareWithTeam ? { shareWithTeam: true } : {}) };
  }

  private requestView(r: RequestRecord): DeviRequest {
    const { files, responseFiles } = this.files.forRequest(r.id);
    return {
      id: r.id, origin: r.origin ?? "session", kind: r.kind ?? "request", fromMemberId: r.fromMemberId, fromSessionId: r.fromSessionId, fromSessionName: r.fromSessionName,
      toMemberId: r.toMemberId, message: r.message, status: r.status, forwardedSessionId: r.forwardedSessionId ?? undefined,
      outcome: r.outcome ?? undefined, outcomeText: r.outcomeText ?? undefined, files, responseFiles,
      createdAt: r.createdAt, sentAt: r.sentAt, deadline: r.deadline, ...withContext(this.store.requestContext(r.id)),
      ...(r.escalatedAt != null ? { escalatedAt: r.escalatedAt } : {}),
      ...(r.closedNote != null ? { closedNote: r.closedNote } : {}),
      ...(r.replacedBy != null ? { replacedBy: r.replacedBy } : {}),
    };
  }
}
