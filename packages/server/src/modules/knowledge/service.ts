import { type KnowledgeEntry, scanForSecrets } from "@devi/protocol";
import type { Access } from "../../core/auth";
import type { BusEvents } from "../../core/bus";
import { HttpError } from "../../core/http";
import type { ModuleContext } from "../../core/module";
import { pushUser } from "../../core/push";
import type { KnowledgeRecord, KnowledgeStore } from "./store";

// Lo que publica requests al responder con "Guardar en la base del equipo".
export type SharedAnswer = BusEvents["request.shared"];

// Base de conocimiento: indexa las respuestas compartidas (salvo si parecen tener secretos), busca y retira.
export class KnowledgeManager {
  constructor(
    private store: KnowledgeStore,
    private ctx: ModuleContext,
  ) {}

  private get team() {
    return this.ctx.services.get("team");
  }

  // Pregunta y respuesta pasan por el detector de secretos: si salta, no se publica y se avisa a quien respondió
  // (solo las etiquetas de lo detectado, nunca el valor).
  onShared(s: SharedAnswer): void {
    const found = [...scanForSecrets(s.question), ...scanForSecrets(s.answer)].map((f) => f.label);
    if (found.length > 0) {
      pushUser(this.ctx.sse, s.answeredBy, { type: "knowledge.refused", requestId: s.requestId, reasons: [...new Set(found)] });
      return;
    }
    const e: KnowledgeRecord = {
      id: crypto.randomUUID(), requestId: s.requestId, question: s.question, answer: s.answer,
      askedBy: s.askedBy, answeredBy: s.answeredBy, createdAt: s.answeredAt,
    };
    if (!this.store.insert(e)) return;
    this.ctx.services.find("audit")?.record({
      actorMemberId: s.answeredBy, action: "knowledge.shared", targetType: "knowledge", targetId: e.id, details: { requestId: s.requestId },
    });
    pushUser(this.ctx.sse, s.answeredBy, { type: "knowledge.saved", entry: this.view(e) });
  }

  search(q: string, limit: number): KnowledgeEntry[] {
    return this.store.search(q, limit).map((e) => this.view(e));
  }

  // Retirar: quien respondió o un admin.
  withdraw(access: Access, id: string): void {
    const e = this.store.get(id);
    if (!e) throw new HttpError(404, "esa entrada no está en la base del equipo", { code: "not_found" });
    if (e.answeredBy !== access.memberId && !access.perms.has("team.admin")) {
      throw new HttpError(403, "solo quien respondió (o un admin) puede retirarla", { code: "forbidden" });
    }
    this.store.delete(id);
    this.ctx.services.find("audit")?.record({
      actorMemberId: access.memberId, action: "knowledge.withdrawn", targetType: "knowledge", targetId: id,
      details: { requestId: e.requestId, answeredBy: e.answeredBy },
    });
  }

  private view(e: KnowledgeRecord): KnowledgeEntry {
    return { ...e, askedByName: this.team.nameOf(e.askedBy), answeredByName: this.team.nameOf(e.answeredBy) };
  }
}
