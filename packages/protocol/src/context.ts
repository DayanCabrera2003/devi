import { z } from "zod";
import { CONTEXT_LIMITS as L } from "./limits";

// Contexto opcional que acompaña a una solicitud. El agente rellena summary, tried, error y urgency; el MCP
// añade git (rama, último commit y `git diff --stat` acotado) de la carpeta de la sesión, si es un repo.
// Lo escribe el compañero: al agente receptor le llega dentro del bloque no confiable, igual que el mensaje.
export const UrgencySchema = z.enum(["baja", "normal", "alta"]);
export type Urgency = z.infer<typeof UrgencySchema>;

export const GitContextSchema = z.object({
  branch: z.string().max(L.branchChars).optional(),
  commit: z.string().max(L.commitChars).optional(), // hash corto + asunto
  diffStat: z.string().max(L.diffStatChars).optional(),
});
export type GitContext = z.infer<typeof GitContextSchema>;

export const RequestContextSchema = z.object({
  summary: z.string().max(L.textChars).optional(),
  tried: z.string().max(L.textChars).optional(),
  error: z.string().max(L.errorChars).optional(),
  urgency: UrgencySchema.optional(),
  git: GitContextSchema.optional(),
});
export type RequestContext = z.infer<typeof RequestContextSchema>;

const filled = (s: string | undefined): s is string => typeof s === "string" && s.trim().length > 0;

// ¿Tiene algo que mostrar?
export function hasContext(c: RequestContext | undefined | null): c is RequestContext {
  if (!c) return false;
  const g = c.git;
  return filled(c.summary) || filled(c.tried) || filled(c.error) || !!c.urgency || (!!g && (filled(g.branch) || filled(g.commit) || filled(g.diffStat)));
}

// Texto plano del contexto, una etiqueta por campo presente. Sin neutralizar: quien lo entrega al agente lo
// mete en el bloque no confiable (wrapUntrusted neutraliza).
export function contextText(c: RequestContext): string {
  const out: string[] = [];
  if (filled(c.summary)) out.push(`Resumen: ${c.summary.trim()}`);
  if (filled(c.tried)) out.push(`Qué se intentó: ${c.tried.trim()}`);
  if (filled(c.error)) out.push(`Error:\n${c.error.trim()}`);
  if (c.urgency) out.push(`Urgencia: ${c.urgency}`);
  const g = c.git;
  if (g && filled(g.branch)) out.push(`Rama: ${g.branch.trim()}`);
  if (g && filled(g.commit)) out.push(`Último commit: ${g.commit.trim()}`);
  if (g && filled(g.diffStat)) out.push(`Cambios sin commit (git diff --stat):\n${g.diffStat.replace(/\s+$/, "")}`);
  return out.join("\n");
}
