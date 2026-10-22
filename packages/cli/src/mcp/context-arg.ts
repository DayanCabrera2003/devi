import { CONTEXT_LIMITS as L, type GitContext, type RequestContext, RequestContextSchema, contextText, hasContext } from "@devi/protocol";
import { neutralizeInline } from "@devi/protocol";

// Argumento `context` de send_request: lo que pasa el agente (resumen, qué se intentó, error, urgencia) más el
// contexto de git que saca el MCP de la carpeta de la sesión. El agente no puede poner git: siempre es el real.

export type ContextResult = { ok: true; context: RequestContext | undefined } | { ok: false; error: string };

const AGENT_FIELDS = ["summary", "tried", "error"] as const;

const invalid = (why: string): ContextResult => ({
  ok: false,
  error:
    `'context' no es válido (${why}). Es un objeto opcional con summary, tried y error (texto; como mucho ` +
    `${L.textChars}, ${L.textChars} y ${L.errorChars} caracteres) y urgency ("baja", "normal" o "alta"). No se envió nada.`,
});

export async function outgoingContext(raw: unknown, git: () => Promise<GitContext | undefined>): Promise<ContextResult> {
  if (raw !== undefined && raw !== null && (typeof raw !== "object" || Array.isArray(raw))) return invalid("no es un objeto");
  const given = (raw ?? {}) as Record<string, unknown>;
  const picked: Record<string, unknown> = {};
  for (const k of AGENT_FIELDS) {
    const v = given[k];
    if (v === undefined || v === null) continue;
    if (typeof v !== "string") return invalid(`${k} debe ser texto`);
    if (v.trim()) picked[k] = v.trim();
  }
  if (given.urgency !== undefined && given.urgency !== null) picked.urgency = given.urgency;
  const fromGit = await git();
  if (fromGit && hasContext({ git: fromGit })) picked.git = fromGit;
  const parsed = RequestContextSchema.safeParse(picked);
  if (!parsed.success) {
    return invalid(parsed.error.issues.map((i) => `${i.path.join(".") || "context"}: ${i.message}`).join("; "));
  }
  return { ok: true, context: hasContext(parsed.data) ? parsed.data : undefined };
}

// Texto donde se buscan secretos e inyección: todos los campos, también los de git.
export const contextScanText = (c: RequestContext): string => contextText(c);

// Una línea para el resultado de la herramienta: qué contexto salió con la solicitud.
export function contextNote(c: RequestContext | undefined): string {
  if (!c) return "";
  const parts: string[] = [];
  if (c.summary) parts.push("resumen");
  if (c.tried) parts.push("qué se intentó");
  if (c.error) parts.push("error");
  if (c.urgency) parts.push(`urgencia ${c.urgency}`);
  if (c.git?.branch) parts.push(`rama ${neutralizeInline(c.git.branch, 80)}`);
  if (c.git?.commit) parts.push("último commit");
  if (c.git?.diffStat) parts.push("git diff --stat");
  return `\n\nContexto incluido: ${parts.join(", ")}.`;
}
