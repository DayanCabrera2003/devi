import type { DeviClient } from "@devi/client";
import type { SessionDelivery } from "@devi/protocol";
import { type DeliveryMessage, materializeDelivery } from "../deliveries";

export type RelayDeps = {
  channel: boolean; // DEVI_CHANNEL=1: Claude Code cargó el canal
  client: DeviClient;
  receivedDir: string;
  notify: (m: DeliveryMessage) => Promise<void>;
  log: (...a: unknown[]) => void;
};

// Una entrega del SSE de la sesión. Con canal: se empuja por el canal y se confirma su entrada de la bandeja
// (meta.inbox_id), para que el hook no la repita. Sin canal, Claude Code descartaría la notificación:
// no se empuja ni se confirma, y el hook la recoge de la bandeja cuando el usuario escribe.
export async function relayDelivery(d: SessionDelivery, deps: RelayDeps): Promise<void> {
  if (!deps.channel) return;
  try {
    await deps.notify(await materializeDelivery(d, deps));
  } catch (e) {
    deps.log(`no se pudo entregar un evento ${d.kind}: ${(e as Error).message}`);
    return;
  }
  const id = d.meta.inbox_id;
  if (!id) return;
  await deps.client.call("ackInbox", { body: { ids: [id] } }).catch((e: Error) => {
    deps.log(`no se pudo confirmar la entrega ${id}: ${e.message}`);
  });
}
