import type { Member } from "@devi/protocol";
import { errorMessage } from "../api";
import type { ConversationItem, ConversationsHttp } from "../conversations-api";

export type ConversationFilter = "all" | "waiting";

// Una fila de la lista: cada compañero, con o sin conversación todavía.
export type ConversationRow = {
  memberId: string;
  name: string;
  login: string;
  roleIds: string[];
  connected: boolean;
  lastAt: number | null;
  lastPreview: string | null;
  lastFromMe: boolean;
  waiting: number;
};

type TeamMember = Member & { connected?: boolean };

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// extraWaiting: lo que la bandeja local sabe que espera (por si el servidor aún no lo cuenta).
export function buildRows(
  items: ConversationItem[],
  members: TeamMember[],
  myId: string | null,
  extraWaiting: Record<string, number> = {},
): ConversationRow[] {
  const byId = new Map(items.map((i) => [i.memberId, i]));
  const rows = members
    .filter((m) => m.id !== myId && (!m.disabled || byId.has(m.id)))
    .map((m): ConversationRow => {
      const i = byId.get(m.id);
      return {
        memberId: m.id,
        name: m.name,
        login: m.login,
        roleIds: m.roleIds,
        connected: !!m.connected && !m.disabled,
        lastAt: i?.lastAt ?? null,
        lastPreview: i?.lastPreview ?? null,
        lastFromMe: i?.lastFromMe ?? false,
        waiting: Math.max(i?.waitingOnMe ?? 0, extraWaiting[m.id] ?? 0),
      };
    });
  // Lo más reciente arriba; quien aún no tiene conversación, después y por nombre.
  return rows.sort((a, b) => (b.lastAt ?? -1) - (a.lastAt ?? -1) || a.name.localeCompare(b.name, "es"));
}

export function filterRows(rows: ConversationRow[], filter: ConversationFilter, query: string): ConversationRow[] {
  const q = fold(query.trim());
  return rows.filter(
    (r) => (filter === "all" || r.waiting > 0) && (!q || fold(r.name).includes(q) || fold(r.login).includes(q)),
  );
}

export class ConversationsStore {
  items = $state<ConversationItem[]>([]);
  loaded = $state(false);
  loading = $state(false);
  error = $state<string | null>(null);
  filter = $state<ConversationFilter>("all");
  query = $state("");

  private seq = 0;

  // Solo la última carga escribe (varios eventos seguidos pueden pedir la lista a la vez).
  async load(http: Pick<ConversationsHttp, "conversations">): Promise<void> {
    const mine = ++this.seq;
    this.loading = true;
    try {
      const r = await http.conversations();
      if (mine !== this.seq) return;
      this.items = r.items;
      this.error = null;
      this.loaded = true;
    } catch (e) {
      if (mine === this.seq) this.error = errorMessage(e);
    } finally {
      if (mine === this.seq) this.loading = false;
    }
  }

  clear(): void {
    this.seq++;
    this.items = [];
    this.loaded = false;
    this.loading = false;
    this.error = null;
  }
}
