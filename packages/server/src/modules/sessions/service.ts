import { type HookBody, type InboxItem, type InboxQuery, PRESENCE, type RegisterSessionBody, type Session, type SessionDelivery } from "@devi/protocol";
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
// "api" → "api (2)" → "api (3)"… hasta que no esté en `taken` (en minúsculas).
export function uniqueSessionName(name: string, taken: ReadonlySet<string>): string {
  const base = name.trim();
  let candidate = base;
  for (let n = 2; taken.has(candidate.toLocaleLowerCase("es")); n++) candidate = `${base} (${n})`;
  return candidate;
}

const INBOX_KINDS: ReadonlySet<string> = new Set(["request", "response", "draft_authorized", "draft_discarded", "escalation"]);

export class SessionManager implements SessionsService {
  // instanceId de MCP sustituidos por otro del mismo Claude Code: no pueden volver a registrarse.
  private replacedInstances = new Set<string>();

  constructor(
    private store: SessionsStore,
    private presence: Presence,
    private now: () => number,
    private changed: (memberId: string) => void, // sessions.updated a la app de esa persona
    private removed: (sessionId: string) => void = () => {}, // cierra su SSE y avisa por el bus
  ) {}

  // El MCP registra su sesión. Reglas de identidad (ver docs/arquitectura.md, "Identidad y sesiones"):
  // 1. Mismo proceso `devi mcp` (mismo instanceId; sin él, mismo Claude Code): es una reconexión y se
  //    devuelve la misma sesión, con su nombre.
  // 2. Si no, sustituye a las sesiones del mismo Claude Code (misma persona, máquina y pid): Claude Code
  //    relanzó su MCP. El MCP sustituido ya no puede volver (409 session_replaced).
  // 3. El nombre pedido se hace único entre las sesiones activas de la persona: "api", "api (2)"…
  //    Nunca se sustituye una sesión por llamarse igual: dos Claude Code en la misma carpeta conviven.
  // La sesión no cuenta como viva hasta que abre su SSE.
  register(memberId: string, body: z.output<typeof RegisterSessionBody>): Session {
    const now = this.now();
    if (body.instanceId && this.replacedInstances.has(`${memberId}\n${body.instanceId}`)) {
      throw new HttpError(409, "otra sesión de Devi ocupa ya este Claude Code (se relanzó el MCP); esta se cierra", {
        code: "session_replaced",
      });
    }
    const existing = body.instanceId
      ? this.store.byInstance(memberId, body.instanceId)
      : this.store.legacySame(memberId, body.machine, body.parentPid);
    if (existing) {
      // Si estuvo caída y entretanto otra sesión activa tomó su nombre, se le da otro libre.
      const others = this.activeNames(memberId, existing.id);
      if (others.has(existing.name.toLocaleLowerCase("es"))) this.store.rename(existing.id, uniqueSessionName(body.name, others));
      this.store.updateOnReregister(existing.id, { cwd: body.cwd, channel: body.channel, lastSeen: now, claudeSessionId: body.claudeSessionId ?? null });
      return this.toSession(this.store.get(existing.id)!);
    }
    for (const old of this.store.sameClaudeCode(memberId, body.machine, body.parentPid)) {
      if (old.instanceId) this.rememberReplaced(`${memberId}\n${old.instanceId}`);
      this.remove(old.id);
    }
    const taken = this.activeNames(memberId, null);
    const rec: SessionRecord = {
      id: crypto.randomUUID(), memberId, name: uniqueSessionName(body.name, taken), cwd: body.cwd, parentPid: body.parentPid,
      status: "idle", claudeSessionId: body.claudeSessionId ?? null, lastSeen: now, channel: body.channel,
      machine: body.machine, instanceId: body.instanceId ?? null,
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
    const rec = this.pairFor(memberId, body);
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
    const rec = this.pairFor(memberId, q);
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

  // Emparejamiento hook ↔ sesión, solo entre las sesiones ACTIVAS de quien llama (nunca de otra persona ni
  // una ya muerta, aunque se reutilice su pid). Por orden:
  // 1. mismo Claude Code (máquina y pid) y mismo claudeSessionId;
  // 2. mismo Claude Code: el pid es único entre los procesos vivos de una máquina, así que manda sobre un
  //    claudeSessionId que otra sesión pudo heredar (Claude Code lanzado dentro de Claude Code);
  // 3. mismo claudeSessionId (lo dio el MCP o un hook anterior): cubre un hook que no es hijo directo.
  private pairFor(memberId: string, q: { parentPid: number; machine: string; claudeSessionId: string }): SessionRecord | null {
    const active = this.store.ofMember(memberId).filter((r) => this.isActive(r)).sort((a, b) => b.lastSeen - a.lastSeen);
    const sameCc = active.filter((r) => r.machine === q.machine && r.parentPid === q.parentPid);
    return (
      sameCc.find((r) => r.claudeSessionId === q.claudeSessionId) ??
      sameCc[0] ??
      (q.claudeSessionId ? active.find((r) => r.claudeSessionId === q.claudeSessionId) : undefined) ??
      null
    );
  }

  // Activa = viva (SSE + latidos) o con señales recientes (recién registrada, aún sin abrir su SSE).
  private isActive(r: SessionRecord): boolean {
    return this.isAlive(r.id) || r.lastSeen >= this.now() - PRESENCE.staleMs;
  }

  private activeNames(memberId: string, except: string | null): Set<string> {
    return new Set(
      this.store.ofMember(memberId).filter((r) => r.id !== except && this.isActive(r)).map((r) => r.name.toLocaleLowerCase("es")),
    );
  }

  private rememberReplaced(key: string): void {
    if (this.replacedInstances.size >= 10_000) this.replacedInstances.clear();
    this.replacedInstances.add(key);
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
