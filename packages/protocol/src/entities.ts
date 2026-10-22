import { z } from "zod";
import { RequestContextSchema } from "./context";
import { PERMS } from "./perms";

export const PermSchema = z.enum(PERMS);

export const RoleSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  color: z.string(),
  capabilities: z.array(z.string().min(1)), // las lee el agente para recomendar a quién pedir
  perms: z.array(PermSchema),
});
export type Role = z.infer<typeof RoleSchema>;

export const MemberSchema = z.object({
  id: z.string(),
  login: z.string().min(1), // login de Tailscale
  name: z.string().min(1),
  description: z.string(),
  roleIds: z.array(z.string()),
  disabled: z.boolean(),
});
export type Member = z.infer<typeof MemberSchema>;

export const SessionStatusSchema = z.enum(["idle", "working"]);
export const SessionSchema = z.object({
  id: z.string(),
  memberId: z.string(),
  name: z.string(),
  cwd: z.string(),
  status: SessionStatusSchema,
  lastSeen: z.number(),
  channel: z.boolean(), // canal de Claude Code cargado: las entregas llegan en tiempo real
});
export type Session = z.infer<typeof SessionSchema>;

// Entrega guardada en la bandeja de una sesión hasta que se confirma (ack).
export const InboxItemSchema = z.object({
  id: z.string(),
  kind: z.enum(["request", "response", "draft_authorized", "draft_discarded", "escalation"]),
  content: z.string(),
  meta: z.record(z.string(), z.string()),
  createdAt: z.number(),
});
export type InboxItem = z.infer<typeof InboxItemSchema>;

export const FileMetaSchema = z.object({
  id: z.string(),
  name: z.string(),
  size: z.number().int().nonnegative(),
  direction: z.enum(["request", "response"]),
});
export type FileMeta = z.infer<typeof FileMetaSchema>;

// Tipo de solicitud: request = pedir algo; handoff = traspaso de sesión (el contexto de un trabajo para que
// otra persona lo continúe). Sin campo (servidor anterior) = request.
export const RequestKindSchema = z.enum(["request", "handoff"]);
export type RequestKind = z.infer<typeof RequestKindSchema>;

const DraftBase = z.object({
  id: z.string(),
  authorMemberId: z.string(),
  authorSessionId: z.string(),
  message: z.string(),
  status: z.enum(["awaiting", "authorized", "discarded"]),
  files: z.array(FileMetaSchema),
  createdAt: z.number(),
  expiresAt: z.number(),
  context: RequestContextSchema.optional(), // solo borradores de solicitud que lo traigan
});
export const DraftSchema = z.discriminatedUnion("kind", [
  DraftBase.extend({ kind: z.literal("request"), toMemberId: z.string(), requestKind: RequestKindSchema.default("request") }),
  DraftBase.extend({ kind: z.literal("response"), requestId: z.string(), shareWithTeam: z.boolean().optional() }),
]);
export type Draft = z.infer<typeof DraftSchema>;

export const RequestStatusSchema = z.enum([
  "pending", "forwarded", "accepted", "rejected", "answered", "timed_out", "closed",
]);
export type RequestStatus = z.infer<typeof RequestStatusSchema>;

export const DeviRequestSchema = z.object({
  id: z.string(),
  // session = la pidió un agente y su humano autorizó el borrador; app = la escribió una persona en la app
  // (entonces fromSessionId y fromSessionName son cadenas vacías). Sin campo (servidor anterior) = session.
  origin: z.enum(["session", "app"]).default("session"),
  kind: RequestKindSchema.default("request"),
  fromMemberId: z.string(),
  fromSessionId: z.string(),
  fromSessionName: z.string(),
  toMemberId: z.string(),
  message: z.string(),
  status: RequestStatusSchema,
  forwardedSessionId: z.string().optional(),
  outcome: z.enum(["accepted", "rejected", "answered"]).optional(),
  outcomeText: z.string().optional(),
  files: z.array(FileMetaSchema),
  responseFiles: z.array(FileMetaSchema),
  createdAt: z.number(),
  sentAt: z.number(),
  deadline: z.number(),
  context: RequestContextSchema.optional(), // contexto que añadió el agente (y git de su sesión), si lo hay
  // Escalado: cuándo se avisó al autor de que seguía sin respuesta (como mucho una vez por solicitud).
  escalatedAt: z.number().optional(),
  // Al pedírselo a otra persona: la original queda closed con una nota y el id de la solicitud nueva.
  closedNote: z.string().optional(),
  replacedBy: z.string().optional(),
});
export type DeviRequest = z.infer<typeof DeviRequestSchema>;

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

// Dominio de login permitido ("asai.digital"): sin @, en minúsculas.
export const DomainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/, "dominio inválido (p. ej. empresa.com, sin @)");

// ¿El login es <algo>@<uno de los dominios>? Sin dominios configurados, cualquiera vale.
// Comparación exacta del dominio (sin subdominios) y sin distinguir mayúsculas.
export function loginInDomains(login: string, domains: readonly string[]): boolean {
  if (domains.length === 0) return true;
  const at = login.lastIndexOf("@");
  if (at <= 0) return false;
  const domain = login.slice(at + 1).toLowerCase();
  return domains.some((d) => d.toLowerCase() === domain);
}

// Rangos que acepta el servidor (la app los repite en sus controles). Que fileMaxAgeDays ≥ fileRetentionDays
// lo valida el servicio de settings, porque en un parche parcial depende del valor guardado.
export const SettingsSchema = z.object({
  requestTimeoutMs: z.number().int().min(MINUTE).max(7 * DAY),
  draftTtlMs: z.number().int().min(MINUTE).max(24 * HOUR),
  fileRetentionDays: z.number().int().min(1).max(30),
  fileMaxAgeDays: z.number().int().min(1).max(30),
  // Si no está vacío, solo entran logins @<uno de estos dominios> (403 "domain" antes de mirar el equipo).
  allowedDomains: z.array(DomainSchema).max(20),
  // Aprobar envíos en el chat: si está activo, lo que el usuario aprueba en el aviso de permisos de
  // Claude Code se envía sin pasar por la app. Desactivado, todo queda en borrador para la app.
  chatApproval: z.boolean(),
  // Escalado: si una solicitud sigue pending este tiempo, se avisa al autor (sesión y app) para que la pida a
  // otra persona. null = desactivado. Que sea menor que requestTimeoutMs lo valida el servicio de settings.
  escalateAfterMs: z.number().int().min(5 * MINUTE).max(24 * HOUR).nullable(),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const MeSchema = z.object({
  login: z.string(),
  member: MemberSchema,
  roles: z.array(RoleSchema),
  perms: z.array(PermSchema),
});
export type Me = z.infer<typeof MeSchema>;

export const TeamViewSchema = z.object({
  members: z.array(MemberSchema.extend({ connected: z.boolean() })),
  roles: z.array(RoleSchema),
});
export type TeamView = z.infer<typeof TeamViewSchema>;
