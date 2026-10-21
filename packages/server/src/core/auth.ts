import type { Perm } from "@devi/protocol";

// Quién llama, según la red (aún sin saber si es del equipo).
export type Principal = { login: string; displayName: string };

// Qué puede hacer: lo resuelve el módulo team a partir del login.
export type Access = { memberId: string; perms: ReadonlySet<Perm> };
export type AccessResolver = (login: string) => Access | null;
