// 1 s, 2 s, 4 s… hasta 30 s.
export const backoffDelayMs = (attempt: number) => Math.min(30_000, 1000 * 2 ** attempt);
