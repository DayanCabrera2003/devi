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

  // La caducidad se mira aquí también: el evento «expired» puede tardar en llegar.
  openFor(t: ClaimTarget): Claim | null {
    return this.list.find((c) => c.target.type === t.type && c.target.id === t.id && c.expiresAt > Date.now()) ?? null;
  }
}
