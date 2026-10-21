import type { HookBody, InboxItem, InboxQuery, RegisterSessionBody, Session, SessionDelivery } from "@devi/protocol";
import type { z } from "zod";
import { HttpError } from "../../core/http";
import type { Presence } from "../../core/presence";
import { sessionKey, userKey } from "../../core/push";
import type { SessionsService } from "../../core/services";
import type { SessionRecord, SessionsStore } from "./store";

// Una sesión sin señales en 24 h se borra (la poda corre cada hora).
export const SESSION_PRUNE_MS = 24 * 3_600_000;
// Las entregas sin confirmar de la bandeja caducan a los 7 días.
export const INBOX_TTL_MS = 7 * 86_400_000;
const INBOX_KINDS: ReadonlySet<string> = new Set(["request", "response", "draft_authorized", "draft_discarded"]);

export class SessionManager implements SessionsService {
  constructor(
    private store: SessionsStore,
    private presence: Presence,
    private now: () => number,
    private changed: (memberId: string) => void, // sessions.updated a la app de esa persona
    private removed: (sessionId: string) => void = () => {}, // cierra su SSE y avisa por el bus
  ) {}

  // El MCP registra su sesión. Idempotente: si ya existe una con la misma persona, nombre y pid padre
  // (el MCP se reconecta tras caerse su stream), devuelve esa misma. Si no, sustituye a la anterior con
  // el mismo nombre o del mismo Claude Code. La sesión no cuenta como viva hasta que abre su SSE.
  register(memberId: string, body: z.output<typeof RegisterSessionBody>): Session {
    const existing = this.store.same(memberId, body.name, body.parentPid);
    if (existing) {
      this.store.updateOnReregister(existing.id, body.cwd, body.channel, this.now());
      return this.toSession(this.store.get(existing.id)!);
    }
    for (const id of this.store.replacedBy(memberId, body.name, body.parentPid)) this.remove(id);
    const rec: SessionRecord = {
      id: crypto.randomUUID(), memberId, name: body.name, cwd: body.cwd, parentPid: body.parentPid,
      status: "idle", claudeSessionId: null, lastSeen: this.now(), channel: body.channel,
    };
    this.store.insert(rec);
    this.changed(memberId);
    return this.toSession(rec);
  }

  close(memberId: string, id: string): void {
    this.owned(memberId, id);
    this.remove(id);
    this.changed(memberId);
  }

  // Hook de Claude Code (UserPromptSubmit / Stop). Si no hay sesión de Devi que emparejar, se ignora.
  hook(memberId: string, body: z.output<typeof HookBody>): Session | null {
    const rec = this.store.findForHook(memberId, body.parentPid, body.claudeSessionId);
    if (!rec) return null;
    this.store.updateFromHook(rec.id, body.status, body.claudeSessionId, this.now());
    this.presence.touch(sessionKey(rec.id)); // un hook también es señal de vida
    this.changed(memberId);
    return this.toSession(this.store.get(rec.id)!);
  }

  // Latido: sin sessionId, de la app (user:<id>); con sessionId, de esa sesión.
  heartbeat(memberId: string, sessionId: string | undefined): void {
    if (!sessionId) return this.presence.touch(userKey(memberId));
    this.owned(memberId, sessionId);
    this.store.touch(sessionId, this.now());
    this.presence.touch(sessionKey(sessionId));
  }

  // Comprueba que la sesión existe y es de quien llama.
  owned(memberId: string, id: string): Session {
    const rec = this.store.get(id);
    if (!rec) throw new HttpError(404, "sesión desconocida", { code: "not_found" });
    if (rec.memberId !== memberId) throw new HttpError(403, "esta sesión no es tuya", { code: "forbidden" });
    return this.toSession(rec);
  }

  // ---- bandeja --------------------------------------------------------------

  // Guarda la entrega en la bandeja de la sesión (salvo debug) y la devuelve con meta.inbox_id.
  // Se llama dentro de la transacción del cambio de estado que la provoca.
  enqueue(sessionId: string, d: SessionDelivery): SessionDelivery {
    if (!INBOX_KINDS.has(d.kind)) return d;
    const id = crypto.randomUUID();
    const meta = { ...d.meta, inbox_id: id };
    this.store.insertInbox({
      id, sessionId, kind: d.kind as InboxItem["kind"], content: d.content, meta: JSON.stringify(meta), createdAt: this.now(),
    });
    return { ...d, meta };
  }

  // Entregas sin confirmar de la sesión de quien llama, emparejada como en los hooks. Sin pareja: [].
  inbox(memberId: string, q: z.output<typeof InboxQuery>): InboxItem[] {
    const rec = this.store.findForHook(memberId, q.parentPid, q.claudeSessionId);
    if (!rec) return [];
    const cutoff = this.now() - INBOX_TTL_MS;
    return this.store
      .unacked(rec.id)
      .filter((r) => r.createdAt >= cutoff)
      .map((r) => ({ id: r.id, kind: r.kind, content: r.content, meta: JSON.parse(r.meta) as Record<string, string>, createdAt: r.createdAt }));
  }

  ack(memberId: string, ids: string[]): void {
    this.store.ack(memberId, ids, this.now());
  }

  sweepInbox(): number {
    return this.store.sweepInbox(this.now() - INBOX_TTL_MS);
  }

  opened(id: string): void {
    this.store.touch(id, this.now());
  }

  // Borra las sesiones sin vida y sin señales desde hace SESSION_PRUNE_MS.
  prune(): number {
    const stale = this.store.seenBefore(this.now() - SESSION_PRUNE_MS).filter((id) => !this.isAlive(id));
    for (const id of stale) this.remove(id);
    return stale.length;
  }

  // ---- SessionsService ------------------------------------------------------

  get(id: string): Session | null {
    const rec = this.store.get(id);
    return rec ? this.toSession(rec) : null;
  }

  isAlive(id: string): boolean {
    return this.presence.isAlive(sessionKey(id));
  }

  liveOf(memberId: string): Session[] {
    return this.store.ofMember(memberId).filter((s) => this.isAlive(s.id)).map((s) => this.toSession(s));
  }

  hasLive(memberId: string): boolean {
    return this.store.ofMember(memberId).some((s) => this.isAlive(s.id));
  }

  memberOf(id: string): string | null {
    return this.store.get(id)?.memberId ?? null;
  }

  private remove(id: string): void {
    this.store.delete(id);
    this.presence.forget(sessionKey(id));
    this.removed(id);
  }

  private toSession(r: SessionRecord): Session {
    const seen = this.presence.lastSeenOf(sessionKey(r.id)) ?? 0;
    return { id: r.id, memberId: r.memberId, name: r.name, cwd: r.cwd, status: r.status, lastSeen: Math.max(r.lastSeen, seen), channel: r.channel };
  }
}
