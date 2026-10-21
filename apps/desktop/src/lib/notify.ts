import { OUTCOME, truncate } from "./format";
import type { Card } from "./stores/inbox.svelte";

export type Notice = { title: string; body: string };

export function noticeFor(card: Card, nameOf: (id: string) => string): Notice {
  switch (card.kind) {
    case "draft": {
      const d = card.draft;
      return d.kind === "request"
        ? { title: "Devi · Claude quiere enviar algo", body: truncate(`Para ${nameOf(d.toMemberId)}: ${d.message}`) }
        : { title: "Devi · Claude quiere responder", body: truncate(d.message) };
    }
    case "request":
      return { title: `Devi · ${nameOf(card.request.fromMemberId)} te pide algo`, body: truncate(card.request.message) };
    case "response": {
      const r = card.request;
      const label = OUTCOME[r.outcome ?? "answered"].label;
      return { title: `Devi · Respuesta de ${nameOf(r.toMemberId)}`, body: truncate(r.outcomeText ? `${label}: ${r.outcomeText}` : label) };
    }
    case "timeout":
      return { title: `Devi · Sin respuesta de ${nameOf(card.request.toMemberId)}`, body: truncate(card.request.message) };
  }
}

// Identidad de un aviso: la misma tarjeta reenviada al reconectar no vuelve a avisar,
// pero un reenvío tras timeout (sentAt nuevo) sí.
export function noticeKey(card: Card): string {
  return card.kind === "draft" ? card.key : `${card.key}@${card.request.sentAt}`;
}

export const shouldNotify = (prefs: { notifications: boolean }, paused: boolean) => prefs.notifications && !paused;

export async function sendNative(n: Notice): Promise<void> {
  const { isPermissionGranted, requestPermission, sendNotification } = await import("@tauri-apps/plugin-notification");
  let granted = await isPermissionGranted();
  if (!granted) granted = (await requestPermission()) === "granted";
  if (granted) sendNotification({ title: n.title, body: n.body });
}
