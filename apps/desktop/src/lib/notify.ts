import { OUTCOME, truncate } from "./format";
import type { DeviRequest } from "@devi/protocol";
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

// Una solicitud mía sigue sin respuesta al cumplirse el plazo de escalado.
export function escalationNotice(r: DeviRequest, nameOf: (id: string) => string): Notice {
  return {
    title: `Devi · ${nameOf(r.toMemberId)} aún no ha respondido`,
    body: truncate(`«${r.message}». Puedes usar «Pedírselo a otra persona» en la conversación.`),
  };
}

// Identidad de un aviso: la misma tarjeta reenviada al reconectar no vuelve a avisar,
// pero un reenvío tras timeout (sentAt nuevo) sí.
export function noticeKey(card: Card): string {
  return card.kind === "draft" ? card.key : `${card.key}@${card.request.sentAt}`;
}

// Un solo aviso para todo lo que estaba pendiente al conectar.
export function summaryNotice(n: number): Notice {
  return { title: "Devi", body: `Tienes ${n} avisos pendientes en Devi` };
}

export const shouldNotify = (prefs: { notifications: boolean }, paused: boolean) => prefs.notifications && !paused;

export async function sendNative(n: Notice): Promise<void> {
  const { isPermissionGranted, requestPermission, sendNotification } = await import("@tauri-apps/plugin-notification");
  let granted = await isPermissionGranted();
  if (!granted) granted = (await requestPermission()) === "granted";
  if (granted) sendNotification({ title: n.title, body: n.body });
}
