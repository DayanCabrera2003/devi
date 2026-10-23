import { createHash } from "node:crypto";
import type { Approval, AuditAction, ChatMessage, SendChatMeta, Session, SessionDelivery } from "@devi/protocol";
import type { z } from "zod";
import type { Access } from "../../core/auth";
import { HttpError } from "../../core/http";
import type { ModuleContext } from "../../core/module";
import { deliverToSession, pushUser } from "../../core/push";
import type { AuditDetails } from "../../core/services";
import { chatContent } from "./content";
import type { ChatRecord, ChatStore } from "./store";

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const filesMeta = (files: { id: string; name: string }[]) => JSON.stringify(files.map((f) => ({ id: f.id, name: f.name })));
const sessionGone = () => new HttpError(409, "esa sesión ya no está abierta", { code: "session_gone" });
const notFound = () => new HttpError(404, "mensaje desconocido", { code: "not_found" });

type Outgoing = { to: string; text: string; origin: "app" | "session"; fromSessionName: string };

// Mensajes del chat: enviar (desde la app o, aprobado en el aviso de Claude Code, desde una sesión), leer por
// conversación y mandar uno a una sesión propia. Sin plazos ni estados: un mensaje enviado ya no cambia.
export class ChatManager {
  constructor(
    private store: ChatStore,
    private ctx: ModuleContext,
  ) {}

  private get team() {
    return this.ctx.services.get("team");
  }
  private get sessions() {
    return this.ctx.services.get("sessions");
  }
  private get files() {
    return this.ctx.services.get("files");
  }

  sendFromApp(access: Access, meta: z.output<typeof SendChatMeta>, rawFiles: File[]): Promise<ChatMessage> {
    return this.send(access, { ...meta, origin: "app", fromSessionName: "" }, rawFiles, "chat.sent");
  }

  // Lo escribe Claude: solo con approval "chat" (el humano lo aprobó en el aviso de Claude Code), el ajuste
  // chatApproval activo y desde una sesión viva de quien llama. Si no, se escribe desde la app.
  sendFromSession(access: Access, meta: { sessionId: string; to: string; text: string; approval: Approval }, rawFiles: File[]): Promise<ChatMessage> {
    if (meta.approval !== "chat" || !this.ctx.services.get("settings").get().chatApproval) {
      throw new HttpError(403, "La aprobación en el chat no está disponible: escribe el mensaje desde la app de Devi", {
        code: "chat_approval_unavailable",
      });
    }
    const s = this.ownLiveSession(access, meta.sessionId);
    return this.send(access, { to: meta.to, text: meta.text, origin: "session", fromSessionName: s.name }, rawFiles, "chat.sent_from_session");
  }

  page(me: string, memberId: string, q: { before?: number; limit: number }): { messages: ChatMessage[]; nextBefore?: number } {
    if (memberId === me) throw new HttpError(400, "no hay conversación contigo mismo", { code: "invalid" });
    if (!this.team.member(memberId)) throw new HttpError(404, `"${memberId}" no está en el equipo`, { code: "not_found" });
    const { messages, nextBefore } = this.store.page(me, memberId, q.before, q.limit);
    return { messages: messages.map((m) => this.view(m)), ...(nextBefore !== undefined ? { nextBefore } : {}) };
  }

  last(a: string, b: string): { at: number; text: string; byMemberId: string } | null {
    const m = this.store.last(a, b);
    return m ? { at: m.createdAt, text: m.text, byMemberId: m.fromMemberId } : null;
  }

  // «Enviar a mi sesión»: cualquiera de las dos partes, a una sesión suya viva que entienda el chat.
  toSession(access: Access, id: string, sessionId: string): void {
    const m = this.partyMessage(access, id);
    const s = this.ownLiveSession(access, sessionId);
    this.requireChat(s.id);
    const delivery = this.delivery(access, m);
    // Bandeja y envío juntos: si la sesión se cerró justo ahora (sin stream), no queda nada en su bandeja.
    this.store.transaction(() => {
      const staged = this.sessions.enqueue(s.id, delivery);
      if (!deliverToSession(this.ctx.sse, s.id, staged)) throw sessionGone();
    });
    this.audit("chat.to_session", access.memberId, m.id, { sessionId: s.id, sessionName: s.name });
  }

  // ---- códigos de entrega (modules/claims) ----------------------------------

  claimCheck(access: Access, id: string): void {
    this.partyMessage(access, id);
  }

  // Como toSession, hacia la sesión que canjeó el código y sin empujar por el canal: la entrega vuelve al hook.
  // No se exige isAlive (la sesión recién abierta puede no tener aún su SSE). Todo se valida antes de escribir:
  // si lanza, no ha cambiado nada y claims solo tiene que liberar el código.
  deliverToClaim(access: Access, id: string, sessionId: string, details: AuditDetails): SessionDelivery {
    const m = this.partyMessage(access, id);
    const s = this.sessions.get(sessionId);
    if (!s || s.memberId !== access.memberId) throw sessionGone();
    this.requireChat(s.id);
    let delivery: SessionDelivery | null = null;
    this.store.transaction(() => {
      delivery = this.sessions.enqueue(s.id, this.delivery(access, m));
    });
    this.audit("chat.to_session", access.memberId, m.id, { ...details, sessionId: s.id, sessionName: s.name });
    return delivery!;
  }

  // El mensaje, si quien llama es una de las dos partes.
  private partyMessage(access: Access, id: string): ChatRecord {
    const m = this.store.get(id);
    if (!m || (m.fromMemberId !== access.memberId && m.toMemberId !== access.memberId)) throw notFound();
    return m;
  }

  private requireChat(sessionId: string): void {
    if (!this.sessions.supports(sessionId, "chat")) {
      throw new HttpError(409, "esa sesión usa una versión de Devi que no entiende el chat: actualiza Devi y ábrela de nuevo", {
        code: "session_outdated",
      });
    }
  }

  private delivery(access: Access, m: ChatRecord): SessionDelivery {
    const mine = m.fromMemberId === access.memberId;
    const files = this.files.forMessage(m.id);
    return {
      kind: "chat",
      content: chatContent({
        fromName: this.team.nameOf(m.fromMemberId), toName: this.team.nameOf(m.toMemberId),
        peerId: mine ? m.toMemberId : m.fromMemberId, mine, text: m.text, files,
      }),
      meta: { message_id: m.id, from: m.fromMemberId, from_name: this.team.nameOf(m.fromMemberId), files: filesMeta(files) },
    };
  }

  private async send(access: Access, out: Outgoing, rawFiles: File[], action: AuditAction): Promise<ChatMessage> {
    if (rawFiles.length > 0 && !access.perms.has("files.send")) {
      throw new HttpError(403, 'Te falta el permiso "files.send"', { code: "missing_perm", perm: "files.send" });
    }
    const to = this.recipient(access, out.to);
    const valid = await this.files.validate(rawFiles);
    this.recipient(access, to); // tras el await el destinatario pudo desactivarse
    const m: ChatRecord = {
      id: crypto.randomUUID(), fromMemberId: access.memberId, toMemberId: to, text: out.text.trim(), origin: out.origin,
      fromSessionName: out.fromSessionName, createdAt: this.ctx.now(),
    };
    // Bytes a disco y después filas en una transacción; si falla, se borra lo escrito.
    const written = this.files.write(valid);
    try {
      this.store.transaction(() => {
        this.store.insert(m);
        this.files.recordForMessage({ messageId: m.id, authorMemberId: access.memberId, peerMemberId: to, written });
      });
    } catch (e) {
      this.files.removeWritten(written);
      throw e;
    }
    this.audit(action, access.memberId, m.id, {
      to, toName: this.team.nameOf(to), textSha256: sha256(m.text),
      files: JSON.stringify(valid.map((f) => ({ name: f.name, size: f.size }))),
      ...(out.origin === "session" ? { sessionName: out.fromSessionName } : {}),
    });
    const view = this.view(m);
    for (const [member, peer] of [[m.toMemberId, m.fromMemberId], [m.fromMemberId, m.toMemberId]] as const) {
      pushUser(this.ctx.sse, member, { type: "chat.message", message: view });
      pushUser(this.ctx.sse, member, { type: "conversation.updated", memberId: peer });
    }
    return view;
  }

  private view(m: ChatRecord): ChatMessage {
    return { ...m, files: this.files.forMessage(m.id) };
  }

  private recipient(access: Access, to: string): string {
    const m = this.team.member(to);
    if (!m || m.disabled) throw new HttpError(404, `"${to}" no está en el equipo`, { code: "not_found" });
    if (m.id === access.memberId) throw new HttpError(400, "no puedes escribirte a ti mismo", { code: "invalid" });
    return m.id;
  }

  private ownLiveSession(access: Access, sessionId: string): Session {
    const s = this.sessions.get(sessionId);
    if (!s || s.memberId !== access.memberId || !this.sessions.isAlive(s.id)) throw sessionGone();
    return s;
  }

  private audit(action: AuditAction, actorMemberId: string, targetId: string, details: AuditDetails): void {
    this.ctx.services.find("audit")?.record({ actorMemberId, action, targetType: "chat", targetId, details });
  }
}
