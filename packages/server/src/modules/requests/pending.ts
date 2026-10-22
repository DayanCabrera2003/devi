import type { DeviRequest, Draft, Pending } from "@devi/protocol";
import { HttpError } from "../../core/http";
import type { DraftRecord, RequestRecord, RequestsStore } from "./store";

// Lecturas para el agente (herramientas list_pending y get_request del MCP). Solo devuelven lo que es de
// quien llama: nunca solicitudes en las que no es parte ni borradores ajenos.
export class PendingReads {
  constructor(
    private store: RequestsStore,
    private view: (r: RequestRecord) => DeviRequest,
    private draftView: (d: DraftRecord) => Draft,
  ) {}

  // Lo mismo que la app muestra como tarjetas (ver openCards) más lo que sigue abierto en los dos sentidos.
  of(me: string): Pending {
    const cards = this.store.cardsFor(me).filter((r) => r.fromMemberId === me);
    return {
      incoming: this.store.openFor(me, "to").map(this.view),
      responses: cards.filter((r) => r.status !== "timed_out").map(this.view),
      timedOut: cards.filter((r) => r.status === "timed_out").map(this.view),
      drafts: this.store.awaitingDraftsBy(me).map(this.draftView),
      outgoing: this.store.openFor(me, "from").map(this.view),
    };
  }

  // Una solicitud en la que quien llama es parte. Si no existe o es ajena, 404 (no se revela si existe).
  request(me: string, id: string): DeviRequest {
    const r = this.store.getRequest(id);
    if (!r || (r.fromMemberId !== me && r.toMemberId !== me)) throw new HttpError(404, `no hay ninguna solicitud ${id} tuya`, { code: "not_found" });
    return this.view(r);
  }
}
