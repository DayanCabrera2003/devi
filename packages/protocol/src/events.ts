import { z } from "zod";
import { DeviRequestSchema, DraftSchema } from "./entities";

// SSE de usuario (app de escritorio). En el cable: `event: <type>` + `data: <JSON del evento>`.
export const UserEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("draft.awaiting"), draft: DraftSchema }),
  z.object({ type: z.literal("draft.discarded"), draftId: z.string() }),
  z.object({ type: z.literal("request.incoming"), request: DeviRequestSchema }),
  z.object({ type: z.literal("request.updated"), request: DeviRequestSchema }),
  z.object({ type: z.literal("response.incoming"), request: DeviRequestSchema }),
  z.object({ type: z.literal("request.timed_out"), request: DeviRequestSchema }),
  z.object({ type: z.literal("team.updated") }),
  z.object({ type: z.literal("sessions.updated"), memberId: z.string() }),
]);
export type UserEvent = z.infer<typeof UserEventSchema>;
export type UserEventType = UserEvent["type"];

// SSE de sesión (MCP → canal de Claude Code). En el cable: `event: deliver` + `data: <JSON>`.
export const SESSION_EVENT = "deliver";
export const SessionDeliverySchema = z.object({
  kind: z.enum(["request", "response", "draft_authorized", "draft_discarded", "debug"]),
  content: z.string(), // texto que verá el agente
  meta: z.record(z.string(), z.string()), // atributos del <channel>: request_id, draft_id, files…
});
export type SessionDelivery = z.infer<typeof SessionDeliverySchema>;
