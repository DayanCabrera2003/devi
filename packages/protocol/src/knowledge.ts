import { z } from "zod";

// Base de conocimiento del equipo: respuestas que quien respondió decidió guardar ("Guardar en la base del
// equipo") para que otros las encuentren antes de volver a preguntar. Se guarda la pregunta (el mensaje
// original), la respuesta, quién preguntó, quién respondió y cuándo; nunca los archivos.
// Es texto de compañeros: al agente le llega encuadrado como el resto del contenido no confiable.

export const KNOWLEDGE_LIMITS = { defaultPage: 10, maxPage: 50, maxQuery: 200 } as const;

export const KnowledgeEntrySchema = z.object({
  id: z.string(),
  requestId: z.string(),
  question: z.string(),
  answer: z.string(),
  askedBy: z.string(),
  askedByName: z.string(),
  answeredBy: z.string(),
  answeredByName: z.string(),
  createdAt: z.number(), // cuándo se respondió
});
export type KnowledgeEntry = z.infer<typeof KnowledgeEntrySchema>;

// GET /knowledge?q=&limit=: búsqueda de texto completo (sin q, las más recientes).
export const KnowledgeQuery = z.object({
  q: z.string().trim().max(KNOWLEDGE_LIMITS.maxQuery).default(""),
  limit: z.coerce.number().int().min(1).max(KNOWLEDGE_LIMITS.maxPage).default(KNOWLEDGE_LIMITS.defaultPage),
});

export const KnowledgeResultSchema = z.object({ entries: z.array(KnowledgeEntrySchema) });
export type KnowledgeResult = z.infer<typeof KnowledgeResultSchema>;
