import {
  CLAIM_LIMITS,
  ClaimCodeSchema,
  type Claim,
  type ClaimTarget,
  type ClaimTargetType,
  newClaimCode,
  type RedeemClaimBody,
  type SessionDelivery,
} from "@devi/protocol";
import type { z } from "zod";
import type { Access } from "../../core/auth";
import { HttpError } from "../../core/http";
import type { ModuleContext } from "../../core/module";
import { pushUser } from "../../core/push";
import type { ClaimTargetHandler } from "../../core/services";
import type { ClaimRecord, ClaimsStore } from "./store";

const notFound = () => new HttpError(404, "Ese código no existe: genera otro en la app de Devi", { code: "claim_not_found" });
const used = () => new HttpError(409, "Ese código ya se usó o se canceló: genera otro en la app de Devi", { code: "claim_used" });
const DAY = 86_400_000;

// Códigos de entrega: crear (app), cancelar (app), listar los míos y canjear (hook de la sesión nueva).
// El elemento no cambia hasta el canje: lo reenvía entonces el módulo dueño (requests o chat) con su manejador.
export class ClaimsManager {
  constructor(
    private store: ClaimsStore,
    private ctx: ModuleContext,
  ) {}

  // requests publica "request" y "response"; chat, "chat". Se buscan al usarlos: no importa el orden de MODULES.
  private handler(type: ClaimTargetType): ClaimTargetHandler {
    const h = this.ctx.services.find("requestTargets")?.[type] ?? this.ctx.services.find("chatTargets")?.[type];
    if (!h) throw new HttpError(400, `no se puede enviar un elemento de tipo "${type}" a una sesión nueva`, { code: "invalid" });
    return h;
  }

  create(access: Access, target: ClaimTarget): Claim {
    this.handler(target.type).check(access, target.id);
    const now = this.ctx.now();
    if (this.store.open(access.memberId, now).length >= CLAIM_LIMITS.maxOpenPerMember) {
      throw new HttpError(409, "Tienes demasiados códigos sin usar: usa o cancela alguno", { code: "too_many_claims" });
    }
    let code = newClaimCode();
    while (this.store.exists(code)) code = newClaimCode();
    const rec: ClaimRecord = {
      code, memberId: access.memberId, targetType: target.type, targetId: target.id, createdAt: now,
      expiresAt: now + CLAIM_LIMITS.ttlMs, usedAt: null, usedSession: null, cancelledAt: null,
    };
    this.store.insert(rec);
    return this.emit(rec, "open");
  }

  mine(memberId: string): Claim[] {
    return this.store.open(memberId, this.ctx.now()).map((r) => this.view(r, "open"));
  }

  cancel(access: Access, code: string): void {
    const rec = this.own(access, code);
    if (this.store.cancel(rec.code, this.ctx.now())) {
      this.emit(rec, "cancelled");
      return;
    }
    // Sin filas cambiadas: si ya estaba cancelado, cancelar otra vez no falla; si se usó (o se está canjeando
    // ahora mismo), la app tiene que saber que el elemento ya llegó a una sesión.
    if (this.store.get(rec.code)?.usedAt != null) throw used();
  }

  redeem(access: Access, body: z.output<typeof RedeemClaimBody>): SessionDelivery {
    const rec = this.store.get(body.code);
    if (!rec || rec.memberId !== access.memberId) {
      // La ficha se gasta solo con códigos que no existen o no son tuyos (lo que frena probar códigos a ciegas):
      // los reintentos del hook con session_unknown no deben agotar la cubeta.
      this.ctx.rateLimit.take("claimRedeem", access.memberId);
      throw notFound();
    }
    const now = this.ctx.now();
    if (rec.usedAt !== null || rec.cancelledAt !== null) {
      throw used();
    }
    if (rec.expiresAt <= now) {
      throw new HttpError(410, "Ese código caducó: genera otro en la app de Devi", { code: "claim_expired" });
    }
    const session = this.ctx.services.get("sessions").pair(access.memberId, body);
    if (!session) {
      throw new HttpError(409, "Esta sesión aún no está conectada a Devi: espera unos segundos y vuelve a pegar la frase", {
        code: "session_unknown",
      });
    }
    if (!this.store.reserve(rec.code, now)) {
      throw used();
    }
    let delivery: SessionDelivery;
    try {
      delivery = this.handler(rec.targetType).deliverTo(access, rec.targetId, session.id, { claimCode: rec.code });
    } catch (e) {
      this.store.release(rec.code);
      throw e;
    }
    this.store.recordSession(rec.code, session.id);
    this.emit(rec, "used");
    return delivery;
  }

  // Avisa a la app de los caducados y borra lo de hace más de un día.
  sweep(): void {
    const now = this.ctx.now();
    for (const rec of this.store.takeExpired(now)) this.emit(rec, "expired");
    this.store.purge(now - DAY);
  }

  private own(access: Access, code: string): ClaimRecord {
    const canonical = ClaimCodeSchema.safeParse(code.toUpperCase());
    if (!canonical.success) throw notFound();
    const rec = this.store.get(canonical.data);
    if (!rec || rec.memberId !== access.memberId) throw notFound();
    return rec;
  }

  private view(r: ClaimRecord, status: Claim["status"]): Claim {
    return { code: r.code, target: { type: r.targetType, id: r.targetId }, expiresAt: r.expiresAt, status };
  }

  private emit(r: ClaimRecord, status: Claim["status"]): Claim {
    const claim = this.view(r, status);
    pushUser(this.ctx.sse, r.memberId, { type: "claim.updated", claim });
    return claim;
  }
}
