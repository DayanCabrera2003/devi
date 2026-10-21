import type { Me, Role, TeamView } from "@devi/protocol";
import type { DeviApi } from "../api";

export class TeamStore {
  me = $state<Me | null>(null);
  team = $state<TeamView>({ members: [], roles: [] });
  myId = $derived(this.me?.member.id ?? null);
  isAdmin = $derived(this.me?.perms.includes("team.admin") ?? false);
  connectedCount = $derived(this.team.members.filter((m) => m.connected && !m.disabled).length);

  nameOf(id: string): string {
    return this.team.members.find((m) => m.id === id)?.name ?? id;
  }

  role(id: string): Role | undefined {
    return this.team.roles.find((r) => r.id === id);
  }

  async refresh(api: Pick<DeviApi, "me" | "team">): Promise<void> {
    const [me, team] = await Promise.all([api.me(), api.team()]);
    this.me = me;
    this.team = team;
  }
}
