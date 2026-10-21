import type { Perm } from "@devi/protocol";

// Quién llama, según la red (aún sin saber si es del equipo).
export type Principal = { login: string; displayName: string };

// Qué puede hacer: lo resuelve el módulo team a partir del login.
export type Access = { memberId: string; perms: ReadonlySet<Perm> };
export type AccessResolver = (login: string) => Access | null;

export interface IdentityProvider {
  readonly name: string;
  identify(req: Request): Principal | null;
}

// Producción: el servidor escucha en 127.0.0.1 y `tailscale serve` añade estas cabeceras
// (y elimina las que traiga el cliente). Sin cabecera → no hay identidad.
export class TailscaleServeIdentity implements IdentityProvider {
  readonly name = "tailscale-serve";
  identify(req: Request): Principal | null {
    const login = req.headers.get("Tailscale-User-Login");
    if (!login) return null;
    return { login, displayName: req.headers.get("Tailscale-User-Name") || login };
  }
}

// Solo desarrollo y tests (DEVI_DEV=1, bind loopback): identidad por cabecera o por ?devUser=.
export class DevIdentity implements IdentityProvider {
  readonly name = "dev";
  identify(req: Request): Principal | null {
    const login = req.headers.get("X-Devi-Dev-User") || new URL(req.url).searchParams.get("devUser");
    return login ? { login, displayName: login } : null;
  }
}
