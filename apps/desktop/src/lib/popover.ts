// Panel de avisos (ventana `avisos`) que se abre desde el icono de la bandeja.
import type { DeviRequest } from "@devi/protocol";
import type { Card } from "./stores/inbox.svelte";
import { AGENT_THREAD, cardPeer } from "./thread-items";

// Etiqueta de la ventana (la crea Rust bajo demanda, ver src-tauri/src/popover.rs).
export const POPOVER_LABEL = "avisos";
// Del panel a la ventana principal: abrir esta conversación / ir a una vista.
export const OPEN_CONVERSATION_EVENT = "devi://open-conversation";
export const NAVIGATE_EVENT = "devi://navigate";
export const PAUSED_EVENT = "devi://paused";
// Oculto más de este tiempo, el panel suelta su conexión con el servidor (sin latidos duplicados).
export const IDLE_DISCONNECT_MS = 30_000;

// Lo que el panel pide a su ventana (Tauri en la app, dobles en los tests).
export type PopoverHost = {
  openMain: (memberId: string | null) => void;
  openSettings: () => void;
  close: () => void;
};

export function popoverTitle(pending: number): string {
  if (pending === 0) return "Todo tranquilo";
  return pending === 1 ? "1 cosa te espera" : `${pending} cosas te esperan`;
}

// Cabecera compacta de cada tarjeta y la conversación a la que lleva.
export function cardHeading(
  c: Card,
  nameOf: (id: string) => string,
  lookup: (id: string) => DeviRequest | undefined,
): { title: string; memberId: string } {
  const peer = cardPeer(c, lookup);
  const memberId = peer ?? AGENT_THREAD;
  switch (c.kind) {
    case "request":
      return { title: `${nameOf(memberId)} te pide`, memberId };
    case "response":
      return { title: `Respuesta de ${nameOf(memberId)}`, memberId };
    case "timeout":
      return { title: `${nameOf(memberId)} no contestó`, memberId };
    case "draft":
      return { title: peer ? `Tu agente → ${nameOf(peer)}` : "Tu agente quiere responder", memberId };
  }
}

// La ventana del panel es transparente: html y body no pintan fondo, solo el panel redondeado.
export function markPopoverDocument(doc: Document): void {
  doc.documentElement.classList.add(POPOVER_LABEL);
  doc.body.classList.add(POPOVER_LABEL);
}

// Solo Linux necesita la nota de la extensión AppIndicator de GNOME.
export function isLinux(userAgent: string): boolean {
  return /Linux/i.test(userAgent) && !/Android/i.test(userAgent);
}
