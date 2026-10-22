import { z } from "zod";

// GET /me/week: el resumen de los últimos 7 días de quien llama (solo sus datos, nunca los del equipo).
// - sent: solicitudes que envié; received: las que me enviaron (por fecha de creación);
// - answered: las que respondí (aceptar, rechazar o responder), por fecha de la respuesta;
// - avgResponseMs: lo que tardé de media en responderlas desde que me llegaron (null si no respondí ninguna);
// - topHelped: a quién más ayudé (respuestas aceptadas o con respuesta, no rechazos), como mucho WEEK_TOP.
export const WEEK_MS = 7 * 86_400_000;
export const WEEK_TOP = 3;

export const WeekSchema = z.object({
  from: z.number(),
  to: z.number(),
  sent: z.number().int().nonnegative(),
  received: z.number().int().nonnegative(),
  answered: z.number().int().nonnegative(),
  avgResponseMs: z.number().nonnegative().nullable(),
  topHelped: z.array(z.object({ memberId: z.string(), count: z.number().int().positive() })).max(WEEK_TOP),
});
export type Week = z.infer<typeof WeekSchema>;
