// Pedírselo a otra persona: a quién se puede elegir y cuándo se ofrece.
import type { DeviRequest, TeamView } from "@devi/protocol";

export type Candidate = { id: string; name: string; connected: boolean; roles: string[]; capabilities: string[] };

// El resto del equipo activo (sin mí ni quien ya la tiene), conectados primero y por nombre. Como el agente,
// la persona compara roles y capacidades; Devi no elige por ella.
export function reassignCandidates(team: TeamView, me: string | null, current: string): Candidate[] {
  const roleOf = new Map(team.roles.map((r) => [r.id, r]));
  return team.members
    .filter((m) => !m.disabled && m.id !== me && m.id !== current)
    .map((m) => {
      const roles = m.roleIds.flatMap((id) => (roleOf.has(id) ? [roleOf.get(id)!] : []));
      return {
        id: m.id, name: m.name, connected: m.connected, roles: roles.map((r) => r.name),
        capabilities: [...new Set(roles.flatMap((r) => r.capabilities))],
      };
    })
    .sort((a, b) => Number(b.connected) - Number(a.connected) || a.name.localeCompare(b.name, "es"));
}

// Solo mis solicitudes que nadie ha empezado (pending) o que vencieron sin respuesta (timed_out).
export const canReassign = (r: DeviRequest, me: string | null) =>
  r.fromMemberId === me && (r.status === "pending" || r.status === "timed_out");
