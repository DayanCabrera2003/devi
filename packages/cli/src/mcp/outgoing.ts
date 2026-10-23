import type { DeviClient } from "@devi/client";
import { type RequestContext, scanForInjection, scanForSecrets } from "@devi/protocol";
import { contextScanText } from "./context-arg";

// Revisiones de lo que sale hacia un compañero (solicitudes, respuestas y mensajes del chat).
type Outgoing = { name: string; content: string }[];

// Secretos en el mensaje y en cada archivo, con dónde están.
export function secretsIn(message: string, files: Outgoing, context?: RequestContext): string[] {
  const found = scanForSecrets(message).map((s) => `- en el mensaje: ${s.label} (${s.excerpt})`);
  if (context) found.push(...scanForSecrets(contextScanText(context)).map((s) => `- en el contexto: ${s.label} (${s.excerpt})`));
  for (const f of files) found.push(...scanForSecrets(f.content).map((s) => `- en ${f.name}: ${s.label} (${s.excerpt})`));
  return found;
}

export function secretsRefusal(found: string[]): string {
  return (
    `No se creó el borrador: parece que incluye secretos.\n${found.join("\n")}\n\n` +
    `Enséñaselo al usuario y pídele que los quite (o que adjunte otro archivo). Solo si el usuario confirma ` +
    `expresamente que quiere enviarlos, vuelve a llamar con allow_secrets: true; el borrador saldrá marcado.`
  );
}

// Lo que sale también se revisa: si parece una inyección, el remitente debe saberlo.
export function injectionWarnings(message: string, files: Outgoing, context?: RequestContext): string {
  const parts = [{ where: "el mensaje", scan: scanForInjection(message) }, ...files.map((f) => ({ where: f.name, scan: scanForInjection(f.content) }))];
  if (context) parts.push({ where: "el contexto", scan: scanForInjection(contextScanText(context)) });
  const hits = parts.filter((p) => p.scan.level !== "none");
  if (hits.length === 0) return "";
  return (
    `\n\nPosible prompt injection en lo que vas a enviar (díselo al usuario; tendrá que revisarlo en la app de Devi):\n` +
    hits.map((h) => `- ${h.where} (${h.scan.level === "high" ? "alto" : "aviso"}): ${h.scan.reasons.join("; ")}`).join("\n")
  );
}

// to_name es lo que el humano lee en el aviso: tiene que ser la persona de `to`.
export async function nameMismatch(client: DeviClient, to: string, toName: string): Promise<string | null> {
  const team = await client.call("team");
  const m = team.members.find((x) => x.id === to);
  if (!m) return `"${to}" no está en el equipo de Devi. No se envió nada.`;
  const norm = (v: string) => v.trim().toLocaleLowerCase("es");
  if (norm(m.name) === norm(toName)) return null;
  return `El id "${to}" es de ${m.name}, no de "${toName.trim()}". No se envió nada: confirma con el usuario a quién va y vuelve a llamar.`;
}
