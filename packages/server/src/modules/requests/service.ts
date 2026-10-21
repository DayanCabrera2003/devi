import type { API, CreateDraftMeta, DeviRequest, Draft, SessionDelivery, UserEvent } from "@devi/protocol";
import type { z } from "zod";
import type { Access } from "../../core/auth";
import { HttpError } from "../../core/http";
import type { ModuleContext } from "../../core/module";
import { deliverToSession, pushUser } from "../../core/push";
import { authorizedContent, type DiscardReason, discardedContent, requestContent, responseContent } from "./content";
import type { DraftRecord, RequestRecord, RequestsStore } from "./store";
import { KeyedTimers } from "./timers";

type DraftMeta = z.output<typeof CreateDraftMeta>;

const draftKey = (id: string) => `draft:${id}`;
const requestKey = (id: string) => `request:${id}`;
const RESPONSE_OPEN = ["accepted", "rejected", "answered"] as const;
const isResponseOpen = (s: RequestRecord["status"]) => (RESPONSE_OPEN as readonly string[]).includes(s);

// meta.files de las entregas: JSON de [{id, name}]. El MCP descarga los archivos y da rutas locales al agente.
const filesMeta = (files: { id: string; name: string }[]) => JSON.stringify(files.map((f) => ({ id: f.id, name: f.name })));
const conflict = (message: string) => new HttpError(409, message, { code: "conflict" });
const sessionGone = () => new HttpError(409, "esa sesión ya no está abierta", { code: "session_gone" });

// Ciclo de vida de borradores y solicitudes (ver el diagrama de estados del spec).
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
  async createDraft(access: Access, meta: DraftMeta, rawFiles: File[]): Promise<Draft> {
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

    if (request) {
      const previous = this.store.awaitingResponseDraft(request.id);
      if (previous) this.discard(previous, "replaced");
    }
    const now = this.ctx.now();
    const d: DraftRecord = {
      id: crypto.randomUUID(), kind: meta.kind, authorMemberId: access.memberId, authorSessionId: session.id,
      authorSessionName: session.name, toMemberId: meta.kind === "request" ? peer : null, requestId: request?.id ?? null,
      message: meta.message.trim(), status: "awaiting", createdAt: now, expiresAt: now + this.settings.draftTtlMs,
    };
    this.store.insertDraft(d);
    this.files.store({ draftId: d.id, direction: d.kind, authorMemberId: access.memberId, peerMemberId: peer, files: valid });
    if (request) this.timers.cancel(requestKey(request.id)); // el plazo se pausa mientras haya borrador de respuesta
    this.timers.at(draftKey(d.id), d.expiresAt, () => this.expire(d.id));
    const view = this.draftView(d);
    this.push(access.memberId, { type: "draft.awaiting", draft: view });
    return view;
  }

  authorize(access: Access, id: string): Draft {
    const d = this.authoredAwaiting(access, id);
    const now = this.ctx.now();
    if (d.kind === "request") {
      const to = this.team.member(d.toMemberId!);
      if (!to || to.disabled) throw conflict(`${this.team.nameOf(d.toMemberId!)} ya no está en el equipo`);
      const r: RequestRecord = {
        id: this.newRequestId(), fromMemberId: d.authorMemberId, fromSessionId: d.authorSessionId,
        fromSessionName: d.authorSessionName, toMemberId: to.id, message: d.message, status: "pending",
        forwardedSessionId: null, outcome: null, outcomeText: null, createdAt: now, sentAt: now,
        deadline: now + this.settings.requestTimeoutMs,
      };
      this.store.transaction(() => {
        this.store.insertRequest(r);
        this.store.setDraftStatus(d.id, "authorized");
        this.files.attachToRequest(d.id, r.id);
      });
      this.timers.cancel(draftKey(d.id));
      this.schedule(r);
      const view = this.requestView(r);
      this.push(r.toMemberId, { type: "request.incoming", request: view });
      this.push(r.fromMemberId, { type: "request.updated", request: view });
      this.deliver(d.authorSessionId, {
        kind: "draft_authorized",
        content: authorizedContent({ kind: "request", toName: to.name, requestId: r.id }),
        meta: { draft_id: d.id, request_id: r.id },
      });
    } else {
      const r = this.requestOr404(d.requestId!);
      if (r.status !== "forwarded") throw conflict(`la solicitud ya está ${r.status}`);
      r.status = "answered";
      r.outcome = "answered";
      r.outcomeText = d.message;
      this.store.transaction(() => {
        this.store.saveRequest(r);
        this.store.setDraftStatus(d.id, "authorized");
        this.files.attachToRequest(d.id, r.id);
      });
      this.timers.cancel(draftKey(d.id));
      this.timers.cancel(requestKey(r.id));
      const view = this.requestView(r);
      this.push(r.fromMemberId, { type: "response.incoming", request: view });
      this.push(r.toMemberId, { type: "request.updated", request: view });
      this.deliver(d.authorSessionId, {
        kind: "draft_authorized",
        content: authorizedContent({ kind: "response", fromName: this.team.nameOf(r.fromMemberId), requestId: r.id }),
        meta: { draft_id: d.id, request_id: r.id },
      });
    }
    return this.draftView(this.store.getDraft(d.id)!);
  }

  discardByAuthor(access: Access, id: string): Draft {
    const d = this.authoredAwaiting(access, id);
    this.discard(d, "discarded");
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
    this.store.setDraftStatus(d.id, "discarded");
    this.timers.cancel(draftKey(d.id));
    this.push(d.authorMemberId, { type: "draft.discarded", draftId: d.id });
    const target =
      d.kind === "request"
        ? ({ kind: "request", toName: this.team.nameOf(d.toMemberId!) } as const)
        : ({ kind: "response", requestId: d.requestId! } as const);
    this.deliver(d.authorSessionId, {
      kind: "draft_discarded",
      content: discardedContent(target, reason, Math.round(this.settings.draftTtlMs / 60_000)),
      meta: { draft_id: d.id, reason, ...(d.requestId ? { request_id: d.requestId } : {}) },
    });
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

  // ---- acciones de B (destinatario) -----------------------------------------

  forward(access: Access, id: string, sessionId: string): DeviRequest {
    const r = this.received(access, id);
    if (r.status !== "pending") throw conflict(`la solicitud ya está ${r.status}`);
    const s = this.sessions.get(sessionId);
    if (!s || s.memberId !== r.toMemberId || !this.sessions.isAlive(s.id)) throw sessionGone();
    const files = this.files.forRequest(r.id).files;
    const delivered = this.deliver(s.id, {
      kind: "request",
      content: requestContent({ id: r.id, fromName: this.team.nameOf(r.fromMemberId), fromSessionName: r.fromSessionName, message: r.message, files }),
      meta: {
        request_id: r.id, from: r.fromMemberId, from_name: this.team.nameOf(r.fromMemberId),
        from_session: r.fromSessionName, files: filesMeta(files),
      },
    });
    // Si la sesión se cerró justo ahora, la solicitud sigue pendiente y la app avisa.
    if (!delivered) throw sessionGone();
    r.status = "forwarded";
    r.forwardedSessionId = s.id;
    this.store.saveRequest(r);
    return this.pushBoth(r, "request.updated");
  }

  accept(access: Access, id: string, note: string | undefined): DeviRequest {
    const r = this.received(access, id);
    if (r.status !== "pending") throw conflict(`la solicitud ya está ${r.status}`);
    r.status = r.outcome = "accepted";
    r.outcomeText = note?.trim() || null;
    return this.answer(r);
  }

  reject(access: Access, id: string, reason: string): DeviRequest {
    const r = this.received(access, id);
    if (!reason.trim()) throw new HttpError(400, "el rechazo necesita un motivo", { code: "invalid" });
    if (r.status !== "pending") throw conflict(`la solicitud ya está ${r.status}`);
    r.status = r.outcome = "rejected";
    r.outcomeText = reason.trim();
    return this.answer(r);
  }

  // ---- acciones de A (remitente) --------------------------------------------

  acceptResponse(access: Access, id: string): DeviRequest {
    const r = this.sent(access, id);
    if (!isResponseOpen(r.status)) throw conflict(`no hay respuesta abierta (estado: ${r.status})`);
    return this.close(r);
  }

  forwardResponse(access: Access, id: string, sessionId: string): DeviRequest {
    const r = this.sent(access, id);
    if (!isResponseOpen(r.status)) throw conflict(`no hay respuesta abierta (estado: ${r.status})`);
    const s = this.sessions.get(sessionId);
    if (!s || s.memberId !== r.fromMemberId || !this.sessions.isAlive(s.id)) throw sessionGone();
    const files = this.files.forRequest(r.id).responseFiles;
    const delivered = this.deliver(s.id, {
      kind: "response",
      content: responseContent({
        toName: this.team.nameOf(r.toMemberId), message: r.message, outcome: r.outcome!, outcomeText: r.outcomeText, files,
      }),
      meta: { request_id: r.id, from: r.toMemberId, outcome: r.outcome ?? "", files: filesMeta(files) },
    });
    if (!delivered) throw sessionGone();
    return this.close(r);
  }

  resend(access: Access, id: string): DeviRequest {
    const r = this.sent(access, id);
    if (r.status !== "timed_out") throw conflict(`la solicitud está ${r.status}`);
    const now = this.ctx.now();
    r.status = "pending";
    r.forwardedSessionId = null;
    r.sentAt = now;
    r.deadline = now + this.settings.requestTimeoutMs;
    this.store.saveRequest(r);
    this.schedule(r);
    const view = this.requestView(r);
    this.push(r.toMemberId, { type: "request.incoming", request: view });
    this.push(r.fromMemberId, { type: "request.updated", request: view });
    return view;
  }

  ignore(access: Access, id: string): DeviRequest {
    const r = this.sent(access, id);
    if (r.status !== "timed_out") throw conflict(`la solicitud está ${r.status}`);
    return this.close(r);
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
    const view = this.requestView(r);
    this.push(r.fromMemberId, { type: "request.timed_out", request: view });
    this.push(r.toMemberId, { type: "request.updated", request: view });
  }

  private schedule(r: RequestRecord): void {
    this.timers.at(requestKey(r.id), r.deadline, () => this.onDeadline(r.id));
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

  // Solo para pruebas: mensaje "debug" a una sesión o a las sesiones vivas de una persona.
  debugPush(access: Access, body: z.output<typeof API.debugPush.body>): number {
    const targets = body.sessionId ? [body.sessionId] : this.sessions.liveOf(body.memberId ?? access.memberId).map((s) => s.id);
    return targets.filter((id) => this.deliver(id, { kind: "debug", content: body.content, meta: {} })).length;
  }

  // ---- utilidades -----------------------------------------------------------

  private answer(r: RequestRecord): DeviRequest {
    this.store.saveRequest(r);
    this.timers.cancel(requestKey(r.id));
    const view = this.requestView(r);
    this.push(r.fromMemberId, { type: "response.incoming", request: view });
    this.push(r.toMemberId, { type: "request.updated", request: view });
    return view;
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

  private push(memberId: string, event: UserEvent): void {
    pushUser(this.ctx.sse, memberId, event);
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
    };
    return d.kind === "request" ? { ...base, kind: "request", toMemberId: d.toMemberId! } : { ...base, kind: "response", requestId: d.requestId! };
  }

  private requestView(r: RequestRecord): DeviRequest {
    const { files, responseFiles } = this.files.forRequest(r.id);
    return {
      id: r.id, fromMemberId: r.fromMemberId, fromSessionId: r.fromSessionId, fromSessionName: r.fromSessionName,
      toMemberId: r.toMemberId, message: r.message, status: r.status, forwardedSessionId: r.forwardedSessionId ?? undefined,
      outcome: r.outcome ?? undefined, outcomeText: r.outcomeText ?? undefined, files, responseFiles,
      createdAt: r.createdAt, sentAt: r.sentAt, deadline: r.deadline,
    };
  }
}
