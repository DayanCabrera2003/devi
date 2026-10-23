import { HttpError } from "./http";

// Límites de ritmo por persona, en memoria (se reinician con el servidor). Cubeta de fichas: max fichas
// que se rellenan de forma continua a razón de max por windowMs. El reloj es inyectable (FakeClock en tests).
export type RateLimit = { max: number; windowMs: number };
export type RateLimits = {
  draft: RateLimit; // POST /drafts
  draftFiles: RateLimit; // POST /drafts con archivos (además de draft)
  mutation: RateLimit; // el resto de rutas que cambian algo (salvo el latido de presencia)
  claimRedeem: RateLimit; // POST /claims/redeem (además de mutation)
};

const MINUTE = 60_000;
export const DEFAULT_RATE_LIMITS: RateLimits = {
  draft: { max: 20, windowMs: 10 * MINUTE },
  draftFiles: { max: 5, windowMs: 10 * MINUTE },
  mutation: { max: 120, windowMs: MINUTE },
  claimRedeem: { max: 10, windowMs: 10 * MINUTE },
};

type Bucket = { tokens: number; at: number };

export class RateLimiter {
  private limits: RateLimits;
  private buckets = new Map<string, Bucket>();

  constructor(
    private now: () => number,
    overrides: Partial<RateLimits> = {},
  ) {
    this.limits = { ...DEFAULT_RATE_LIMITS, ...overrides };
  }

  // Gasta una ficha de la cubeta (name, key) o lanza 429 con Retry-After.
  take(name: keyof RateLimits, key: string): void {
    const { max, windowMs } = this.limits[name];
    const now = this.now();
    const id = `${name}:${key}`;
    const b = this.buckets.get(id) ?? { tokens: max, at: now };
    b.tokens = Math.min(max, b.tokens + ((now - b.at) * max) / windowMs);
    b.at = now;
    if (b.tokens < 1) {
      this.buckets.set(id, b);
      const secs = Math.max(1, Math.ceil((((1 - b.tokens) * windowMs) / max) / 1000));
      throw new HttpError(429, `Vas demasiado rápido: espera ${secs} s y vuelve a intentarlo`, { code: "rate_limit", retryAfter: secs }, {
        "Retry-After": String(secs),
      });
    }
    b.tokens -= 1;
    this.buckets.set(id, b);
    if (this.buckets.size > 10_000) this.prune(now);
  }

  // Olvida las cubetas ya llenas (equivalen a no tener ninguna).
  private prune(now: number): void {
    for (const [id, b] of this.buckets) {
      const { max, windowMs } = this.limits[id.slice(0, id.indexOf(":")) as keyof RateLimits];
      if (b.tokens + ((now - b.at) * max) / windowMs >= max) this.buckets.delete(id);
    }
  }
}
