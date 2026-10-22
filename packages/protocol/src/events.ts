import { z } from "zod";
import { AuditEntrySchema } from "./audit";
import { DeviRequestSchema, DraftSchema } from "./entities";
import { KnowledgeEntrySchema } from "./knowledge";

// SSE de usuario (app de escritorio). En el cable: `event: <type>` + `data: <JSON del evento>`.
export const UserEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("draft.awaiting"), draft: DraftSchema }),
  z.object({ type: z.literal("draft.discarded"), draftId: z.string() }),
  z.object({ type: z.literal("request.incoming"), request: DeviRequestSchema }),
  z.object({ type: z.literal("request.updated"), request: DeviRequestSchema }),
  z.object({ type: z.literal("response.incoming"), request: DeviRequestSchema }),
  z.object({ type: z.literal("request.timed_out"), request: DeviRequestSchema }),
  // Una solicitud mía sigue sin respuesta al cumplirse escalateAfterMs: la app propone pedírsela a otra persona.
  z.object({ type: z.literal("request.escalated"), request: DeviRequestSchema }),
  z.object({ type: z.literal("team.updated") }),
  // Cambió alguna solicitud (o borrador) entre esta persona y memberId: la app recarga esa conversación.
  z.object({ type: z.literal("conversation.updated"), memberId: z.string() }),
  z.object({ type: z.literal("sessions.updated"), memberId: z.string() }),
  // Solo a admins: cambios sensibles (roles y permisos, personas añadidas o desactivadas, ajustes, logins rechazados).
  z.object({ type: z.literal("audit.alert"), entry: AuditEntrySchema }),
  // A quien respondió: su respuesta ya está en la base del equipo, o no se guardó (posibles secretos).
  z.object({ type: z.literal("knowledge.saved"), entry: KnowledgeEntrySchema }),
  z.object({ type: z.literal("knowledge.refused"), requestId: z.string(), reasons: z.array(z.string()) }),
]);
export type UserEvent = z.infer<typeof UserEventSchema>;
export type UserEventType = UserEvent["type"];

// SSE de sesión (MCP → canal de Claude Code). En el cable: `event: deliver` + `data: <JSON>`.
export const SESSION_EVENT = "deliver";
export const SessionDeliverySchema = z.object({
  kind: z.enum(["request", "response", "draft_authorized", "draft_discarded", "escalation", "debug"]),
  content: z.string(), // texto que verá el agente
  meta: z.record(z.string(), z.string()), // atributos del <channel>: request_id, draft_id, files…
});
export type SessionDelivery = z.infer<typeof SessionDeliverySchema>;
