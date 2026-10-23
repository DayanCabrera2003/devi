import { z } from "zod";

// Código de entrega: «+ Sesión nueva» en la app crea uno de un solo uso; pegado como primer mensaje en una sesión
// nueva de Claude Code («devi: recibir K7Q-4MX»), el hook lo canjea y esa sesión recibe el elemento.
// Sin 0/O, 1/I/L: se lee y se teclea sin dudas.
export const CLAIM_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CLAIM_LIMITS = { ttlMs: 600_000, maxOpenPerMember: 10 } as const;

export const ClaimTargetSchema = z.object({ type: z.enum(["request", "response", "chat"]), id: z.string().min(1).max(64) });
export type ClaimTarget = z.infer<typeof ClaimTargetSchema>;
export type ClaimTargetType = ClaimTarget["type"];

// Forma canónica: 6 símbolos en mayúsculas, sin guion.
export const ClaimCodeSchema = z.string().regex(new RegExp(`^[${CLAIM_ALPHABET}]{6}$`));
export const ClaimStatusSchema = z.enum(["open", "used", "cancelled", "expired"]);
export const ClaimSchema = z.object({ code: ClaimCodeSchema, target: ClaimTargetSchema, expiresAt: z.number(), status: ClaimStatusSchema });
export type Claim = z.infer<typeof ClaimSchema>;

export function newClaimCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  // 256 % 31 deja un sesgo mínimo (8 de 256), irrelevante con caducidad de 10 min y límite de intentos.
  return [...bytes].map((b) => CLAIM_ALPHABET[b % CLAIM_ALPHABET.length]).join("");
}

export const formatClaimCode = (code: string) => `${code.slice(0, 3)}-${code.slice(3)}`;
export const claimPhrase = (code: string) => `devi: recibir ${formatClaimCode(code)}`;

const PHRASE = /^\s*devi\s*:\s*recibir\s+([a-z0-9]{3})-?([a-z0-9]{3})(?![a-z0-9])/i;

// El código si el mensaje EMPIEZA con la frase; null si no.
export function parseClaimPhrase(text: string): string | null {
  const m = PHRASE.exec(text);
  if (!m) return null;
  const code = `${m[1]}${m[2]}`.toUpperCase();
  return ClaimCodeSchema.safeParse(code).success ? code : null;
}
