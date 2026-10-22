import type { DeviClient } from "@devi/client";
import { type DeviRequest, type Me, PERM_LABELS, type Session, type TeamView } from "@devi/protocol";
import { type FormatCtx, ago, formatDraft, formatRequest, inline } from "./format";

// Herramientas de solo lectura: ayudan al agente a razonar (quién soy, quién puede ayudar, qué hay pendiente)
// sin adivinar. Nunca cambian nada en el servidor.

export type ReadDeps = {
  client: DeviClient;
  session: () => Session | null;
  receivedDir: string;
  now: () => number;
};

export class ToolInputError extends Error {}

export const CONVERSATION_DEFAULT = 10;
export const CONVERSATION_MAX = 30;

const SELF =
  "eres tú: todas tus sesiones de Claude Code son el mismo miembro de Devi. Tus otras sesiones salen en whoami " +
  "y, en la app de Devi, en el selector de sesiones al reenviar algo.";

async function context(deps: ReadDeps): Promise<{ me: Me; team: TeamView; ctx: FormatCtx }> {
  const [me, team] = await Promise.all([deps.client.call("me"), deps.client.call("team")]);
  const ctx: FormatCtx = {
    meId: me.member.id,
    names: new Map(team.members.map((m) => [m.id, m.name])),
    now: deps.now(),
    sessionId: deps.session()?.id ?? null,
    receivedDir: deps.receivedDir,
  };
  return { me, team, ctx };
}

const sessionLabel = (s: Session) => `"${inline(s.name, 80)}" (${s.status === "working" ? "trabajando" : "libre"}, en ${inline(s.cwd, 200)})`;

export async function whoami(deps: ReadDeps): Promise<string> {
  const me = await deps.client.call("me");
  const live = await deps.client.call("memberSessions", { params: { id: me.member.id } });
  const mine = deps.session();
  const caps = [...new Set(me.roles.flatMap((r) => r.capabilities))];
  const lines = [
    "# Tú en Devi",
    `- Persona: ${inline(me.member.name, 80)} (login ${inline(me.login, 120)}, id ${me.member.id})`,
    `- Roles: ${me.roles.map((r) => inline(r.name, 60)).join(", ") || "ninguno"}`,
    `- Capacidades (lo que puedes hacer fuera de Devi): ${caps.map((c) => inline(c, 120)).join("; ") || "ninguna"}`,
    `- Permisos en Devi: ${me.perms.map((p) => PERM_LABELS[p] ?? p).join(", ") || "ninguno (no puedes enviar solicitudes)"}`,
  ];
  if (mine) {
    lines.push(
      `- Esta sesión: "${inline(mine.name, 80)}" (id ${mine.id}), carpeta ${inline(mine.cwd, 200)}`,
      mine.channel
        ? "- Canal en tiempo real: sí (las solicitudes y respuestas llegan al momento como <channel source=\"devi\">)"
        : "- Canal en tiempo real: no (las entregas llegan cuando el usuario escribe, como <devi kind=...> al principio de su mensaje)",
    );
  } else {
    lines.push("- Esta sesión aún no está registrada en Devi (¿el servidor está encendido?). Vuelve a probar en unos segundos.");
  }
  const others = live.filter((s) => s.id !== mine?.id);
  lines.push(
    others.length > 0
      ? `- Tus otras sesiones activas (el mismo miembro: no puedes enviarles solicitudes; se eligen en la app al reenviar): ${others.map(sessionLabel).join("; ")}`
      : "- No tienes otras sesiones activas.",
  );
  return lines.join("\n");
}

export async function listTeammates(deps: ReadDeps): Promise<string> {
  const [{ me, team, ctx }, convs] = await Promise.all([context(deps), deps.client.conversations()]);
  const byMember = new Map(convs.items.map((c) => [c.memberId, c]));
  const roles = new Map(team.roles.map((r) => [r.id, r]));
  // Nunca yo (aunque tenga otras sesiones vivas) ni personas desactivadas. Conectados primero.
  const people = team.members
    .filter((m) => m.id !== me.member.id && !m.disabled)
    .sort((a, b) => Number(b.connected) - Number(a.connected) || a.name.localeCompare(b.name, "es"));
  if (people.length === 0) return "No hay más personas en el equipo de Devi (sin contarte a ti).";
  const sessions = await Promise.all(
    people.map((m) => (m.connected ? deps.client.call("memberSessions", { params: { id: m.id } }) : Promise.resolve([] as Session[]))),
  );
  const blocks = people.map((m, i) => {
    const rs = m.roleIds.map((id) => roles.get(id)).filter((r) => r !== undefined);
    const caps = [...new Set(rs.flatMap((r) => r.capabilities))];
    const n = sessions[i]!.length;
    const online = m.connected ? `conectada/o, ${n} ${n === 1 ? "sesión" : "sesiones"} de Claude Code activa${n === 1 ? "" : "s"}` : "desconectada/o (le llegará igual cuando vuelva)";
    const c = byMember.get(m.id);
    const last = c?.lastAt ? `última interacción ${ago(c.lastAt, ctx.now)}` : "sin interacciones todavía";
    const waiting = c && c.waitingOnMe > 0 ? `; te espera: ${c.waitingOnMe} (mira list_pending)` : "";
    return [
      `## ${inline(m.name, 80)} (id ${m.id}) · ${online}`,
      `- Roles: ${rs.map((r) => inline(r.name, 60)).join(", ") || "ninguno"}`,
      `- Capacidades: ${caps.map((x) => inline(x, 120)).join("; ") || "ninguna declarada"}`,
      ...(m.description.trim() ? [`- Descripción: ${inline(m.description, 300)}`] : []),
      `- Contigo: ${last}${waiting}`,
    ].join("\n");
  });
  return (
    `# Compañeros en Devi (${people.length}, sin contarte a ti)\n` +
    "Elige por MENOR PRIVILEGIO: la persona cuya capacidad cubre justo lo que hace falta, no quien más permisos tiene. " +
    "Si varias encajan, preséntaselas al usuario con el porqué y una recomendación. Usa el id en `to` y el nombre en `to_name`.\n\n" +
    blocks.join("\n\n")
  );
}

// Persona por id o por nombre (sin distinguir mayúsculas). Nunca uno mismo.
function resolveMember(team: TeamView, meId: string, arg: string) {
  const norm = (v: string) => v.trim().toLocaleLowerCase("es");
  const found = team.members.find((m) => m.id === arg) ?? team.members.filter((m) => norm(m.name) === norm(arg)).at(0);
  if (!found) throw new ToolInputError(`"${inline(arg, 80)}" no está en el equipo de Devi. Usa list_teammates para ver los nombres e ids.`);
  if (found.id === meId) throw new ToolInputError(`"${inline(arg, 80)}" ${SELF}`);
  return found;
}

export async function getConversation(deps: ReadDeps, args: Record<string, unknown>): Promise<string> {
  const arg = typeof args.member === "string" ? args.member.trim() : "";
  if (!arg) throw new ToolInputError("Falta 'member' (id o nombre del compañero, de list_teammates).");
  const raw = typeof args.limit === "number" && Number.isFinite(args.limit) ? Math.floor(args.limit) : CONVERSATION_DEFAULT;
  const limit = Math.min(CONVERSATION_MAX, Math.max(1, raw));
  const { me, team, ctx } = await context(deps);
  const other = resolveMember(team, me.member.id, arg);
  const page = await deps.client.conversation(other.id, { limit });
  const name = inline(other.name, 80);
  if (page.requests.length === 0) return `Todavía no hay solicitudes entre ${name} y tú.`;
  const more = page.nextBefore !== undefined ? `\n\n(Hay más antiguas: vuelve a llamar con un limit mayor, hasta ${CONVERSATION_MAX}.)` : "";
  return `# Conversación con ${name} (las ${page.requests.length} más recientes, de la más nueva a la más vieja)\n\n${page.requests.map((r) => formatRequest(r, ctx)).join("\n\n")}${more}`;
}

export async function listPending(deps: ReadDeps): Promise<string> {
  const [{ ctx }, p] = await Promise.all([context(deps), deps.client.call("pending")]);
  const total = p.incoming.length + p.responses.length + p.timedOut.length + p.drafts.length + p.outgoing.length;
  if (total === 0) return "Nada pendiente en Devi: no te espera nada y no tienes solicitudes abiertas.";
  const toOf = (requestId: string) => {
    const r = [...p.incoming].find((x) => x.id === requestId);
    return r ? ctx.names.get(r.fromMemberId) ?? r.fromMemberId : "quien la pidió";
  };
  const section = (title: string, hint: string, items: string[]) =>
    items.length === 0 ? null : `## ${title} (${items.length})\n${hint}\n\n${items.join("\n\n")}`;
  const reqs = (rs: DeviRequest[]) => rs.map((r) => formatRequest(r, ctx));
  const parts = [
    section(
      "Solicitudes para ti",
      "Las pendientes las decide el usuario en la app de Devi (aceptar, rechazar o reenviar a una sesión). Si están reenviadas a esta sesión, preséntaselas y, cuando decida, responde con respond_to_request.",
      reqs(p.incoming),
    ),
    section("Respuestas a tus solicitudes", "Muéstraselas al usuario y sugiere siguientes pasos; las acepta o reenvía él en la app de Devi.", reqs(p.responses)),
    section("Tus solicitudes caducadas", "Nadie respondió a tiempo. El usuario puede reenviarlas o dejarlas en la app de Devi; no las repitas por tu cuenta.", reqs(p.timedOut)),
    section("Borradores tuyos esperando autorización en la app de Devi", "No salen hasta que el usuario los autorice allí; caducan si no.", p.drafts.map((d) => formatDraft(d, ctx, toOf))),
    section("Tus solicitudes abiertas (esperando al otro lado)", "No hace falta hacer nada; si vencen sin respuesta, llegará un aviso. No insistas antes del plazo.", reqs(p.outgoing)),
  ].filter((x) => x !== null);
  return `# Pendiente en Devi\n\n${parts.join("\n\n")}`;
}

export async function getRequest(deps: ReadDeps, args: Record<string, unknown>): Promise<string> {
  const id = typeof args.request_id === "string" ? args.request_id.trim() : "";
  if (!id) throw new ToolInputError("Falta 'request_id'.");
  const [{ ctx }, r] = await Promise.all([context(deps), deps.client.call("getRequest", { params: { id } })]);
  return `# Solicitud ${r.id}\n\n${formatRequest(r, ctx, true)}`;
}
