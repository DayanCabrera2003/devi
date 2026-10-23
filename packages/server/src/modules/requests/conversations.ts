import { CONVERSATION_LIMITS, type ConversationPage, type ConversationSummary, type DeviRequest } from "@devi/protocol";
import { HttpError } from "../../core/http";
import type { ModuleContext } from "../../core/module";
import type { RequestRecord, RequestsStore } from "./store";

type Last = { at: number; text: string; byMemberId: string };
// Lo más reciente entre la última actividad de las solicitudes y el último mensaje del chat (si el módulo existe).
const latest = (a: Last | null, b: Last | null): Last | null => (!a ? b : !b ? a : b.at > a.at ? b : a);

// Conversaciones por persona: las solicitudes entre quien llama y cada compañero, en los dos sentidos.
// Quien llama siempre es una de las dos partes (la ruta solo nombra a la otra), así nadie lee ajenas.
export class Conversations {
  constructor(
    private store: RequestsStore,
    private ctx: ModuleContext,
    private view: (r: RequestRecord) => DeviRequest,
  ) {}

  private get team() {
    return this.ctx.services.get("team");
  }

  // Una fila por cada otra persona activa. Orden: lo que me espera primero, luego lo más reciente, luego el nombre.
  list(me: string): ConversationSummary[] {
    const rows = this.team
      .memberIds()
      .filter((id) => id !== me && this.team.member(id)?.disabled === false)
      .map((memberId) => {
        const last = latest(this.store.lastActivity(me, memberId), this.ctx.services.find("chat")?.last(me, memberId) ?? null);
        return {
          memberId,
          lastAt: last?.at ?? null,
          lastPreview: last ? last.text.slice(0, CONVERSATION_LIMITS.previewChars) : null,
          lastFromMe: last?.byMemberId === me,
          waitingOnMe: this.store.waitingOn(me, memberId),
        };
      });
    const name = (id: string) => this.team.nameOf(id);
    return rows.sort(
      (a, b) =>
        b.waitingOnMe - a.waitingOnMe || (b.lastAt ?? -Infinity) - (a.lastAt ?? -Infinity) || name(a.memberId).localeCompare(name(b.memberId)),
    );
  }

  page(me: string, memberId: string, q: { before?: number; limit: number }): ConversationPage {
    if (memberId === me) throw new HttpError(400, "no hay conversación contigo mismo", { code: "invalid" });
    if (!this.team.member(memberId)) throw new HttpError(404, `"${memberId}" no está en el equipo`, { code: "not_found" });
    const { requests, nextBefore } = this.store.conversationPage(me, memberId, q.before, q.limit);
    return { requests: requests.map(this.view), ...(nextBefore !== undefined ? { nextBefore } : {}) };
  }
}
