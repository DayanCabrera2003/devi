// Cómo se cuenta una conversación: qué burbujas, en qué orden y con qué estado debajo.
import type { DeviRequest, Draft } from "@devi/protocol";
import type { ThreadRequest } from "./conversations-api";
import { clockTime, daySeparator, sameDayAs } from "./format";
import type { Card } from "./stores/inbox.svelte";
import { mergeRequests } from "./stores/thread.svelte";

// Conversación especial con los borradores del agente que no se sabe a quién van.
export const AGENT_THREAD = "@agente";

export type ThreadItem =
  | { kind: "day"; key: string; label: string }
  | { kind: "request"; key: string; request: ThreadRequest; card: Card | null }
  | { kind: "draft"; key: string; draft: Draft };

type Lookup = (requestId: string) => DeviRequest | undefined;

// A quién va un borrador: el destinatario, o quien hizo la solicitud que responde.
export function draftTarget(d: Draft, lookup: Lookup): string | null {
  if (d.kind === "request") return d.toMemberId;
  return lookup(d.requestId)?.fromMemberId ?? null;
}

// La otra persona de una tarjeta de la bandeja.
export function cardPeer(c: Card, lookup: Lookup): string | null {
  if (c.kind === "draft") return draftTarget(c.draft, lookup);
  return c.kind === "request" ? c.request.fromMemberId : c.request.toMemberId;
}

// Cuántas cosas esperan a cada persona según la bandeja local.
export function waitingByPeer(cards: Card[], lookup: Lookup): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of cards) {
    const peer = cardPeer(c, lookup) ?? AGENT_THREAD;
    out[peer] = (out[peer] ?? 0) + 1;
  }
  return out;
}

const GAP_MS = 60 * 60_000;

// Solicitudes del hilo más las abiertas de la bandeja (que pueden ser más nuevas), y al final los
// borradores del agente. Separador de día al empezar, al cambiar de día o tras una hora sin nada.
export function buildThreadItems(opts: {
  memberId: string;
  requests: ThreadRequest[];
  cards: Card[];
  lookup: Lookup;
  now: number;
}): ThreadItem[] {
  const { memberId, cards, lookup, now } = opts;
  const mine = cards.filter((c) => (cardPeer(c, lookup) ?? AGENT_THREAD) === memberId);
  const cardByRequest = new Map<string, Exclude<Card, { kind: "draft" }>>();
  for (const c of mine) if (c.kind !== "draft") cardByRequest.set(c.request.id, c);
  const requests = mergeRequests(
    opts.requests,
    mine.flatMap((c) => (c.kind === "draft" ? [] : [c.request])),
  );
  const drafts = mine.flatMap((c) => (c.kind === "draft" ? [c.draft] : [])).sort((a, b) => a.createdAt - b.createdAt);

  const items: ThreadItem[] = [];
  let last: number | null = null;
  const stamp = (at: number) => {
    if (last === null || !sameDayAs(last, at) || at - last >= GAP_MS) items.push({ kind: "day", key: `day:${at}`, label: daySeparator(at, now) });
    last = at;
  };
  for (const r of requests) {
    stamp(r.sentAt || r.createdAt);
    const card = cardByRequest.get(r.id) ?? null;
    items.push({ kind: "request", key: `r:${r.id}`, request: card?.request ?? r, card });
  }
  for (const d of drafts) {
    stamp(d.createdAt);
    items.push({ kind: "draft", key: `d:${d.id}`, draft: d });
  }
  return items;
}

export type Tone = "" | "good" | "bad" | "warn";
export type Caption = { text: string; tone: Tone };

// Estado bajo la burbuja de una solicitud: "Enviado", "En su sesión", "Rechazado: <motivo>"…
export function requestCaption(r: DeviRequest, me: string | null): Caption {
  const mine = r.fromMemberId === me;
  const at = clockTime(r.sentAt || r.createdAt);
  const outcome = r.outcome ?? (r.status === "accepted" || r.status === "rejected" || r.status === "answered" ? r.status : undefined);
  let c: Caption;
  if (outcome === "rejected") c = { text: `Rechazado: ${r.outcomeText ?? ""}`.trim(), tone: "bad" };
  else if (outcome === "accepted") c = { text: mine ? "Aceptado: lo hará en persona" : "Lo haces tú", tone: "good" };
  else if (outcome === "answered") c = { text: "Respondido", tone: "good" };
  else if (r.status === "timed_out") c = { text: "Sin respuesta", tone: "warn" };
  else if (r.status === "forwarded") c = { text: mine ? "En su sesión" : "En tu sesión", tone: "" };
  else if (r.status === "closed") c = { text: "Cerrada", tone: "" };
  else c = { text: mine ? "Enviado" : "Recibido", tone: "" };
  return { ...c, text: `${c.text} · ${at}` };
}

// De dónde salió: una sesión con nombre o la propia app.
export function originLabel(r: ThreadRequest): string {
  return r.origin === "app" || !r.fromSessionName ? "desde la app" : `desde «${r.fromSessionName}»`;
}

// ¿La otra persona contestó con texto? Entonces su respuesta va como burbuja propia.
export function hasReplyBubble(r: DeviRequest): boolean {
  const outcome = r.outcome;
  if (outcome === "answered") return true;
  return outcome === "accepted" && !!r.outcomeText?.trim();
}
