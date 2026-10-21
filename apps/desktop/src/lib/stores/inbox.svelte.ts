import type { DeviRequest, Draft, UserEvent } from "@devi/protocol";

export type Card =
  | { kind: "draft"; key: string; draft: Draft }
  | { kind: "request"; key: string; request: DeviRequest }
  | { kind: "response"; key: string; request: DeviRequest }
  | { kind: "timeout"; key: string; request: DeviRequest };

// Qué tarjeta corresponde a una solicitud según su estado y quién soy (o ninguna).
export function cardFor(r: DeviRequest, me: string): Card | null {
  if (r.toMemberId === me && r.status === "pending") return { kind: "request", key: `request:${r.id}`, request: r };
  if (r.fromMemberId === me) {
    if (r.status === "timed_out") return { kind: "timeout", key: `timeout:${r.id}`, request: r };
    if (r.status === "accepted" || r.status === "rejected" || r.status === "answered") {
      return { kind: "response", key: `response:${r.id}`, request: r };
    }
  }
  return null;
}

export type Applied = { cards: Card[]; added: Card | null };

function upsertDraft(cards: Card[], d: Draft): Applied {
  const key = `draft:${d.id}`;
  if (d.status !== "awaiting") return { cards: cards.filter((c) => c.key !== key), added: null };
  const card: Card = { kind: "draft", key, draft: d };
  const i = cards.findIndex((c) => c.key === key);
  if (i < 0) return { cards: [...cards, card], added: card };
  const next = [...cards];
  next[i] = card;
  return { cards: next, added: null };
}

function applyRequest(cards: Card[], r: DeviRequest, me: string): Applied {
  const card = cardFor(r, me);
  const i = cards.findIndex((c) => c.kind !== "draft" && c.request.id === r.id);
  const old = i >= 0 ? cards[i] : undefined;
  if (card && old && old.key === card.key) {
    const next = [...cards];
    next[i] = card;
    return { cards: next, added: null };
  }
  const rest = i >= 0 ? cards.filter((_, j) => j !== i) : cards;
  return card ? { cards: [...rest, card], added: card } : { cards: rest, added: null };
}

// Aplica un evento SSE de usuario. `added` es la tarjeta nueva (para avisar y rebotar).
export function applyEvent(cards: Card[], ev: UserEvent, me: string): Applied {
  switch (ev.type) {
    case "draft.awaiting":
      return upsertDraft(cards, ev.draft);
    case "draft.discarded":
      return { cards: cards.filter((c) => c.key !== `draft:${ev.draftId}`), added: null };
    case "request.incoming":
    case "request.updated":
    case "response.incoming":
    case "request.timed_out":
      return applyRequest(cards, ev.request, me);
    default:
      return { cards, added: null };
  }
}

export class InboxStore {
  cards = $state<Card[]>([]);
  pending = $derived(this.cards.length);

  apply(ev: UserEvent, me: string): Card | null {
    const r = applyEvent(this.cards, ev, me);
    this.cards = r.cards;
    return r.added;
  }

  // Tras una acción propia (forward, aceptar…) el servidor devuelve la solicitud actualizada.
  applyRequest(r: DeviRequest, me: string): void {
    this.apply({ type: "request.updated", request: r }, me);
  }

  // La solicitud de una tarjeta abierta (para dar contexto a un borrador de respuesta).
  requestById(id: string): DeviRequest | undefined {
    for (const c of this.cards) if (c.kind !== "draft" && c.request.id === id) return c.request;
    return undefined;
  }

  remove(key: string): void {
    this.cards = this.cards.filter((c) => c.key !== key);
  }

  clear(): void {
    this.cards = [];
  }
}
