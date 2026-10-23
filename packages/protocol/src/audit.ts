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
  "request.taken_in_chat", // el destinatario la trajo a su sesión (aprobado en el aviso de Claude Code)
  "request.declined_in_chat", // el destinatario la rechazó desde su sesión (aprobado en el aviso de Claude Code)
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
  "chat.sent", // mensaje de chat escrito en la app
  "chat.to_session", // un mensaje del chat mandado a una sesión propia
  "chat.sent_from_session", // mensaje de chat escrito por Claude (aprobado en el aviso de Claude Code)
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];
export const AuditActionSchema = z.enum(AUDIT_ACTIONS);

export const AUDIT_TARGETS = ["draft", "request", "file", "member", "role", "settings", "db", "login", "knowledge", "chat"] as const;
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
// features: lista separada por comas de lo que entiende el cliente (AUDIT_FEATURES). Sin ella (app antigua), las
// acciones nuevas se devuelven como su equivalente antiguo (legacyAuditAction), que su esquema sí acepta.
export const AuditQuery = z.object({
  limit: z.coerce.number().int().min(1).max(AUDIT_LIMITS.maxPage).default(AUDIT_LIMITS.defaultPage),
  before: z.coerce.number().int().positive().optional(),
  features: z.string().max(500).default("").transform((v) => v.split(",").map((x) => x.trim()).filter((x) => x.length > 0)),
});

export const AUDIT_FEATURES = { inChat: "audit_in_chat", chat: "audit_chat" } as const;

// Acciones que una app anterior no conoce → la que sí conoce (con details.via = "chat" para distinguirlas).
const LEGACY_ACTIONS: Partial<Record<AuditAction, AuditAction>> = {
  "request.taken_in_chat": "request.forwarded",
  "request.declined_in_chat": "request.rejected",
  "chat.sent": "request.sent_from_app",
  "chat.to_session": "request.forwarded",
  "chat.sent_from_session": "draft.approved_in_chat",
};
export const legacyAuditAction = (action: AuditAction): AuditAction => LEGACY_ACTIONS[action] ?? action;
// Qué feature tiene que declarar el cliente para recibir una acción tal cual (null = cualquier app la entiende).
export const auditFeatureFor = (action: AuditAction): string | null =>
  action.startsWith("chat.") ? AUDIT_FEATURES.chat : LEGACY_ACTIONS[action] ? AUDIT_FEATURES.inChat : null;
// Igual con el objetivo: una app anterior no conoce "chat".
export const legacyAuditTarget = (target: AuditTarget): AuditTarget => (target === "chat" ? "request" : target);
export const AuditPageSchema = z.object({ entries: z.array(AuditEntrySchema), nextBefore: z.number().int().optional() });
export type AuditPage = z.infer<typeof AuditPageSchema>;
