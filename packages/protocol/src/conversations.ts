import { z } from "zod";
import { DeviRequestSchema } from "./entities";

// Enviar desde la app: POST /requests es multipart, con el campo "meta" (JSON de este esquema) y
// 0..5 campos "files". Lo manda una persona desde la app, así que no pasa por borrador.
export const SendFromAppMeta = z.object({ to: z.string(), message: z.string().trim().min(1) });

// Una fila por compañero activo (también sin historial: lastAt null). waitingOnMe = lo que espera una
// acción mía con esa persona: solicitudes suyas pendientes, respuestas a las mías sin aceptar ni reenviar,
// solicitudes mías sin respuesta a tiempo y borradores míos esperando para ella.
export const ConversationSummarySchema = z.object({
  memberId: z.string(),
  lastAt: z.number().nullable(),
  lastPreview: z.string().nullable(), // primeros 120 caracteres del último mensaje o respuesta
  lastFromMe: z.boolean(),
  waitingOnMe: z.number().int().nonnegative(),
});
export type ConversationSummary = z.infer<typeof ConversationSummarySchema>;

export const ConversationsResponseSchema = z.object({ items: z.array(ConversationSummarySchema) });
export type ConversationsResponse = z.infer<typeof ConversationsResponseSchema>;

// GET /conversations/:memberId?before=&limit=: de la más nueva a la más vieja, por createdAt.
// nextBefore = valor de before para pedir la página siguiente (ausente si no hay más).
export const CONVERSATION_LIMITS = { defaultPage: 30, maxPage: 100, previewChars: 120 } as const;
export const ConversationQuery = z.object({
  limit: z.coerce.number().int().min(1).max(CONVERSATION_LIMITS.maxPage).default(CONVERSATION_LIMITS.defaultPage),
  before: z.coerce.number().int().positive().optional(),
});
export const ConversationPageSchema = z.object({ requests: z.array(DeviRequestSchema), nextBefore: z.number().optional() });
export type ConversationPage = z.infer<typeof ConversationPageSchema>;
