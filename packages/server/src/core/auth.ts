import type { Perm } from "@devi/protocol";
import { isSseRoute } from "./http";

// Quién llama, según la red (aún sin saber si es del equipo).
export type Principal = { login: string; displayName: string };

// Qué puede hacer: lo resuelve el módulo team a partir del login.
export type Access = { memberId: string; perms: ReadonlySet<Perm> };
export type AccessResolver = (login: string) => Access | null;

export interface IdentityProvider {
  readonly name: string;
  identify(req: Request): Principal | null;
}

const WORD = String.raw`=\?utf-8\?([qb])\?([^?]*)\?=`;
const WORD_RUN = new RegExp(`${WORD}(?:\\s+${WORD})*`, "gi");
const WORD_ONE = new RegExp(WORD, "gi");

function wordBytes(enc: string, text: string): number[] {
  if (enc.toLowerCase() === "b") return [...Buffer.from(text, "base64")];
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === "_") out.push(0x20);
    else if (c === "=" && /^[0-9a-f]{2}$/i.test(text.slice(i + 1, i + 3))) {
      out.push(parseInt(text.slice(i + 1, i + 3), 16));
      i += 2;
    } else out.push(...Buffer.from(c, "utf8"));
  }
  return out;
}

// Tailscale codifica Tailscale-User-Name como palabra codificada RFC 2047 cuando no es ASCII
// (=?utf-8?q?Mar=C3=ADa?=). Palabras contiguas se unen antes de decodificar UTF-8.
// Si el valor no está codificado se devuelve igual.
export function decodeMimeWords(value: string): string {
  return value.replace(WORD_RUN, (run) => {
    const bytes: number[] = [];
    for (const m of run.matchAll(WORD_ONE)) bytes.push(...wordBytes(m[1]!, m[2]!));
    return new TextDecoder().decode(Uint8Array.from(bytes));
  });
}

// Producción: el servidor escucha en 127.0.0.1 y `tailscale serve` añade estas cabeceras
// (y elimina las que traiga el cliente). Sin cabecera → no hay identidad.
export class TailscaleServeIdentity implements IdentityProvider {
  readonly name = "tailscale-serve";
  identify(req: Request): Principal | null {
    const login = req.headers.get("Tailscale-User-Login");
    if (!login) return null;
    return { login, displayName: decodeMimeWords(req.headers.get("Tailscale-User-Name") ?? "") || login };
  }
}

// Solo desarrollo y tests (DEVI_DEV=1, bind loopback): identidad por cabecera o por ?devUser=.
export class DevIdentity implements IdentityProvider {
  readonly name = "dev";
  identify(req: Request): Principal | null {
    const url = new URL(req.url);
    // ?devUser= solo en los SSE (EventSource no admite cabeceras); el resto usa la cabecera.
    const fromQuery = isSseRoute(req.method, url.pathname) ? url.searchParams.get("devUser") : null;
    const login = req.headers.get("X-Devi-Dev-User") || fromQuery;
    return login ? { login, displayName: login } : null;
  }
}
