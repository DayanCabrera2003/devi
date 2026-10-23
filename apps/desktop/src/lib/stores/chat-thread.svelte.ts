import type { ChatMessage, ChatPage } from "@devi/protocol";
import { errorMessage, isApiFailure } from "../api";

export const CHAT_PAGE = 50;

type ChatHttp = { chat(memberId: string, opts: { before?: number; limit: number }): Promise<ChatPage> };

const byTime = (a: ChatMessage, b: ChatMessage) => a.createdAt - b.createdAt || a.id.localeCompare(b.id);

function merge(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const map = new Map(current.map((m) => [m.id, m]));
  for (const m of incoming) map.set(m.id, m);
  return [...map.values()].sort(byTime);
}

// Un servidor anterior no tiene chat: GET /chat/:id da 404 y la conversación sigue solo con solicitudes.
const noChat = (e: unknown) => isApiFailure(e) && e.status === 404;

// Mensajes del chat con una persona (las solicitudes van en ThreadStore), con páginas hacia atrás.
export class ChatThreadStore {
  memberId = $state<string | null>(null);
  messages = $state<ChatMessage[]>([]);
  nextBefore = $state<number | undefined>(undefined);
  loadingMore = $state(false);
  error = $state<string | null>(null);

  private seq = 0;

  async open(http: ChatHttp, memberId: string): Promise<void> {
    const mine = ++this.seq;
    if (this.memberId !== memberId) {
      this.messages = [];
      this.nextBefore = undefined;
    }
    this.memberId = memberId;
    this.error = null;
    try {
      const page = await http.chat(memberId, { limit: CHAT_PAGE });
      if (mine !== this.seq) return;
      this.messages = merge(this.messages, page.messages);
      this.nextBefore ??= page.nextBefore;
    } catch (e) {
      if (mine === this.seq && !noChat(e)) this.error = errorMessage(e);
    }
  }

  async loadMore(http: ChatHttp): Promise<void> {
    const memberId = this.memberId;
    const before = this.nextBefore;
    if (!memberId || before === undefined || this.loadingMore) return;
    const mine = this.seq;
    this.loadingMore = true;
    try {
      const page = await http.chat(memberId, { before, limit: CHAT_PAGE });
      if (mine !== this.seq) return;
      this.messages = merge(this.messages, page.messages);
      this.nextBefore = page.nextBefore;
    } catch (e) {
      if (mine === this.seq) this.error = errorMessage(e);
    } finally {
      this.loadingMore = false;
    }
  }

  // Mensaje nuevo (evento SSE o el que acabo de enviar).
  upsert(m: ChatMessage): void {
    if (this.memberId && (m.fromMemberId === this.memberId || m.toMemberId === this.memberId)) this.messages = merge(this.messages, [m]);
  }

  close(): void {
    this.seq++;
    this.memberId = null;
    this.messages = [];
    this.nextBefore = undefined;
    this.loadingMore = false;
    this.error = null;
  }
}
