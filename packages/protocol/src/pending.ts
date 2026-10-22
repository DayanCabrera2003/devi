import { z } from "zod";
import { DeviRequestSchema, DraftSchema } from "./entities";

// GET /pending: lo que espera a quien llama y el estado de lo que tiene abierto. Es una lectura para el
// agente (herramienta list_pending del MCP); la app recibe lo mismo como tarjetas por su SSE.
// - incoming: solicitudes para mí sin cerrar: pending (esperan que decida) o forwarded (en una de mis sesiones);
// - responses: respuestas a mis solicitudes (accepted, rejected, answered) que aún no acepté ni reenvié;
// - timedOut: mis solicitudes que caducaron sin respuesta (puedo reenviarlas o dejarlas);
// - drafts: mis borradores esperando autorización en la app;
// - outgoing: mis solicitudes aún abiertas en el otro lado (pending o forwarded).
// Todas en orden de creación, de la más antigua a la más nueva.
export const PendingSchema = z.object({
  incoming: z.array(DeviRequestSchema),
  responses: z.array(DeviRequestSchema),
  timedOut: z.array(DeviRequestSchema),
  drafts: z.array(DraftSchema),
  outgoing: z.array(DeviRequestSchema),
});
export type Pending = z.infer<typeof PendingSchema>;
