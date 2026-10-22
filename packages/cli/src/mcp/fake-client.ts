import { DeviApiError, type DeviClient, type SseStatus } from "@devi/client";
import type { SessionDelivery } from "@devi/protocol";

// DeviClient falso para los tests del MCP: cada llamada se apunta y responde lo que diga `responses`.
export type FakeCall = { name: string; opts?: unknown };

export function fakeClient(responses: Record<string, unknown | ((opts: unknown) => unknown)> = {}) {
  const calls: FakeCall[] = [];
  const drafts: { meta: unknown; files: { name: string; content: string }[] }[] = [];
  const subscriptions: { sessionId: string; onDelivery: (d: SessionDelivery) => void; onStatus?: (s: SseStatus, err?: DeviApiError) => void; closed: boolean }[] = [];
  const answer = (name: string, opts?: unknown) => {
    calls.push({ name, opts });
    const r = responses[name];
    if (r instanceof Error) throw r;
    const v = typeof r === "function" ? (r as (o: unknown) => unknown)(opts) : r;
    if (v instanceof Error) throw v;
    return v;
  };
  const client: DeviClient = {
    call: (async (name: string, opts?: unknown) => answer(name, opts)) as DeviClient["call"],
    async createDraft(meta, files) {
      drafts.push({ meta, files });
      return answer("createDraft", meta) as never;
    },
    async sendFromApp(meta, files) {
      return answer("sendFromApp", { meta, files }) as never;
    },
    async conversations() {
      return answer("conversations") as never;
    },
    async conversation(memberId, opts) {
      return answer("conversation", { memberId, ...opts }) as never;
    },
    async downloadFile(id) {
      return answer("downloadFile", id) as string;
    },
    subscribeUser() {
      return () => {};
    },
    subscribeSession(sessionId, onDelivery, opts) {
      const sub = { sessionId, onDelivery, onStatus: opts?.onStatus, closed: false };
      subscriptions.push(sub);
      opts?.onStatus?.("connecting");
      return () => {
        sub.closed = true;
      };
    },
  };
  return { client, calls, drafts, subscriptions };
}

export const unreachable = () =>
  new DeviApiError(0, { error: "No se pudo conectar con el servidor de Devi (http://x).", code: "unreachable" });
