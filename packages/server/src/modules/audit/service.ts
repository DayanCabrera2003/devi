import { AUDIT_LIMITS, AUDIT_SYSTEM_ACTOR, type AuditAction, type AuditEntry, type AuditPage } from "@devi/protocol";
import type { ModuleContext } from "../../core/module";
import { pushUser } from "../../core/push";
import type { AuditDetails, AuditInput, AuditService } from "../../core/services";
import type { AuditStore } from "./store";

const MINUTE = 60_000;
const DAY = 86_400_000;
export const LOGIN_REJECT_WINDOW_MS = 10 * MINUTE;

// Cambios sensibles: además de guardarse, se avisan a los admins (audit.alert).
// member.updated solo alerta si cambian los roles (puede crear un admin nuevo).
const ALERT_ACTIONS: ReadonlySet<AuditAction> = new Set<AuditAction>([
  "member.created", "member.disabled", "member.deleted",
  "role.created", "role.updated", "role.deleted",
  "settings.updated", "login.rejected",
]);

const stringify = (details: AuditDetails = {}): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(details)) if (v !== undefined && v !== null) out[k] = String(v);
  return out;
};

export class AuditManager implements AuditService {
  private lastRejected = new Map<string, number>();

  constructor(
    private store: AuditStore,
    private ctx: ModuleContext,
  ) {}

  record(input: AuditInput): void {
    try {
      const memberId = input.actorMemberId ?? undefined;
      const login =
        input.actorLogin ?? (memberId ? this.ctx.services.find("team")?.member(memberId)?.login : undefined) ?? (memberId ?? AUDIT_SYSTEM_ACTOR);
      const entry = this.store.insert({
        at: this.ctx.now(),
        ...(memberId ? { actorMemberId: memberId } : {}),
        actorLogin: login,
        action: input.action,
        targetType: input.targetType,
        ...(input.targetId ? { targetId: input.targetId } : {}),
        details: stringify(input.details),
      });
      if (input.alert ?? ALERT_ACTIONS.has(input.action)) this.alert(entry);
    } catch (e) {
      this.ctx.log("auditoría: no se pudo registrar", input.action, e);
    }
  }

  loginRejected(login: string, reason: "unknown_login" | "domain"): void {
    const now = this.ctx.now();
    const last = this.lastRejected.get(login);
    if (last !== undefined && now - last < LOGIN_REJECT_WINDOW_MS) return;
    this.lastRejected.set(login, now);
    // Acota la memoria: un atacante podría probar muchos logins distintos.
    if (this.lastRejected.size > 10_000) {
      for (const [k, at] of this.lastRejected) if (now - at >= LOGIN_REJECT_WINDOW_MS) this.lastRejected.delete(k);
    }
    this.record({ actorLogin: login, action: "login.rejected", targetType: "login", targetId: login, details: { reason } });
  }

  page(limit: number, before: number | undefined): AuditPage {
    const entries = this.store.page(limit + 1, before);
    const more = entries.length > limit;
    const shown = entries.slice(0, limit);
    return more ? { entries: shown, nextBefore: shown.at(-1)!.id } : { entries: shown };
  }

  runRetention(): number {
    return this.store.deleteOlderThan(this.ctx.now() - AUDIT_LIMITS.retentionDays * DAY);
  }

  private alert(entry: AuditEntry): void {
    for (const id of this.ctx.services.find("team")?.adminIds() ?? []) pushUser(this.ctx.sse, id, { type: "audit.alert", entry });
  }
}
