import { errorMessage } from "../api";
import type { ConversationsHttp, ThreadRequest } from "../conversations-api";

export const THREAD_PAGE = 30;

export const involves = (r: Pick<ThreadRequest, "fromMemberId" | "toMemberId">, memberId: string) =>
  r.fromMemberId === memberId || r.toMemberId === memberId;

const byTime = (a: ThreadRequest, b: ThreadRequest) => a.createdAt - b.createdAt || a.id.localeCompare(b.id);

// Mezcla sin repetir: la versión que llega reemplaza a la que había.
export function mergeRequests(current: ThreadRequest[], incoming: ThreadRequest[]): ThreadRequest[] {
  const map = new Map(current.map((r) => [r.id, r]));
  for (const r of incoming) map.set(r.id, r);
  return [...map.values()].sort(byTime);
}

// Conversación con una persona, de lo más antiguo a lo más nuevo, con páginas hacia atrás.
export class ThreadStore {
  memberId = $state<string | null>(null);
  requests = $state<ThreadRequest[]>([]);
  nextBefore = $state<number | undefined>(undefined);
  loading = $state(false);
  loadingMore = $state(false);
  loaded = $state(false);
  error = $state<string | null>(null);

  private seq = 0;

  async open(http: Pick<ConversationsHttp, "conversation">, memberId: string): Promise<void> {
    const mine = ++this.seq;
    const same = this.memberId === memberId;
    this.memberId = memberId;
    if (!same) {
      this.requests = [];
      this.nextBefore = undefined;
      this.loaded = false;
    }
    this.loading = true;
    this.error = null;
    try {
      const page = await http.conversation(memberId, { limit: THREAD_PAGE });
      if (mine !== this.seq) return;
      this.requests = mergeRequests(same ? this.requests : [], page.requests);
      if (!same || this.nextBefore === undefined) this.nextBefore = page.nextBefore;
      this.loaded = true;
    } catch (e) {
      if (mine === this.seq) this.error = errorMessage(e);
    } finally {
      if (mine === this.seq) this.loading = false;
    }
  }

  async loadMore(http: Pick<ConversationsHttp, "conversation">): Promise<void> {
    const memberId = this.memberId;
    const before = this.nextBefore;
    if (!memberId || before === undefined || this.loadingMore) return;
    const mine = this.seq;
    this.loadingMore = true;
    this.error = null;
    try {
      const page = await http.conversation(memberId, { before, limit: THREAD_PAGE });
      if (mine !== this.seq) return;
      this.requests = mergeRequests(this.requests, page.requests);
      this.nextBefore = page.nextBefore;
    } catch (e) {
      if (mine === this.seq) this.error = errorMessage(e);
    } finally {
      this.loadingMore = false;
    }
  }

  // Una solicitud nueva o cambiada (evento SSE o respuesta a una acción propia).
  upsert(r: ThreadRequest): void {
    if (this.memberId && involves(r, this.memberId)) this.requests = mergeRequests(this.requests, [r]);
  }

  close(): void {
    this.seq++;
    this.memberId = null;
    this.requests = [];
    this.nextBefore = undefined;
    this.loading = false;
    this.loadingMore = false;
    this.loaded = false;
    this.error = null;
  }
}
