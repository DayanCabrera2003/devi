import type { Claim, ClaimTarget } from "@devi/protocol";

// Mis códigos de entrega vivos («Esperando sesión nueva» en las tarjetas). Se carga al conectar y lo mantiene
// al día el evento claim.updated.
export class ClaimsStore {
  list = $state<Claim[]>([]);

  set(claims: Claim[]): void {
    this.list = claims.filter((c) => c.status === "open");
  }

  apply(c: Claim): void {
    const rest = this.list.filter((x) => x.code !== c.code);
    this.list = c.status === "open" ? [...rest, c] : rest;
  }

  // Date.now() no es reactivo: esto filtra un caducado solo cuando algo vuelve a pintar la tarjeta. La línea
  // «Esperando sesión nueva» desaparece de verdad con el evento «expired» (el servidor barre cada 15 s) o al reconectar.
  openFor(t: ClaimTarget): Claim | null {
    return this.list.find((c) => c.target.type === t.type && c.target.id === t.id && c.expiresAt > Date.now()) ?? null;
  }
}
