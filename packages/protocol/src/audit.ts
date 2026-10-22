import { z } from "zod";

// Registro de auditoría: qué pasó, quién lo hizo y sobre qué. Solo se añade; nadie lo edita ni lo borra
// (salvo la retención). Los textos de los mensajes no se guardan: solo su SHA-256.
export const AUDIT_ACTIONS = [
  "draft.created",
  "draft.authorized",
  "draft.approved_in_chat", // creado y enviado a la vez: el humano lo aprobó en el aviso de Claude Code
  "draft.discarded",
  "draft.expired",
  "request.sent_from_app",
  "request.forwarded",
  "request.accepted",
  "request.rejected",
  "request.answered",
  "request.resent",
  "request.ignored",
  "request.timed_out",
  "request.escalated",
  "request.reassigned", // el remitente se la pidió a otra persona: solicitud nueva y la original cerrada
  "response.accepted",
  "response.forwarded",
  "file.downloaded",
  "member.created",
  "member.updated",
  "member.disabled",
  "member.deleted",
  "role.created",
  "role.updated",
  "role.deleted",
  "settings.updated",
  "db.exported",
  "login.rejected",
  "knowledge.shared",
  "knowledge.withdrawn",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];
export const AuditActionSchema = z.enum(AUDIT_ACTIONS);

export const AUDIT_TARGETS = ["draft", "request", "file", "member", "role", "settings", "db", "login", "knowledge"] as const;
export type AuditTarget = (typeof AUDIT_TARGETS)[number];

// actorLogin "system" = lo hizo el propio servidor (caducidades, plazos).
export const AUDIT_SYSTEM_ACTOR = "system";

export const AUDIT_LIMITS = { retentionDays: 365, defaultPage: 50, maxPage: 200 } as const;

export const AuditEntrySchema = z.object({
  id: z.number().int(),
  at: z.number(),
  actorMemberId: z.string().optional(),
  actorLogin: z.string(),
  action: AuditActionSchema,
  targetType: z.enum(AUDIT_TARGETS),
  targetId: z.string().optional(),
  details: z.record(z.string(), z.string()), // valores compuestos van como JSON
});
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

// GET /audit?limit=&before=: de la más nueva a la más vieja. nextBefore = id para pedir la página siguiente.
export const AuditQuery = z.object({
  limit: z.coerce.number().int().min(1).max(AUDIT_LIMITS.maxPage).default(AUDIT_LIMITS.defaultPage),
  before: z.coerce.number().int().positive().optional(),
});
export const AuditPageSchema = z.object({ entries: z.array(AuditEntrySchema), nextBefore: z.number().int().optional() });
export type AuditPage = z.infer<typeof AuditPageSchema>;
