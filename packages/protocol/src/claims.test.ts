import { describe, expect, test } from "bun:test";
import { CLAIM_ALPHABET, CLAIM_LIMITS, claimPhrase, formatClaimCode, newClaimCode, parseClaimPhrase } from "./claims";

describe("código de entrega", () => {
  test("alfabeto sin símbolos ambiguos", () => {
    expect(CLAIM_ALPHABET).toHaveLength(31);
    for (const c of "01ILO") expect(CLAIM_ALPHABET).not.toContain(c);
  });

  test("newClaimCode: 6 símbolos del alfabeto", () => {
    for (let i = 0; i < 200; i++) {
      const c = newClaimCode();
      expect(c).toMatch(/^[A-Z2-9]{6}$/);
      for (const ch of c) expect(CLAIM_ALPHABET).toContain(ch);
    }
  });

  test("formato y frase", () => {
    expect(formatClaimCode("K7Q4MX")).toBe("K7Q-4MX");
    expect(claimPhrase("K7Q4MX")).toBe("devi: recibir K7Q-4MX");
  });

  test("parseClaimPhrase reconoce variaciones al inicio del mensaje", () => {
    expect(parseClaimPhrase("devi: recibir K7Q-4MX")).toBe("K7Q4MX");
    expect(parseClaimPhrase("  Devi:recibir k7q4mx\n")).toBe("K7Q4MX");
    expect(parseClaimPhrase("DEVI : RECIBIR K7Q-4MX y luego más texto")).toBe("K7Q4MX");
  });

  test("parseClaimPhrase ignora lo demás", () => {
    expect(parseClaimPhrase("hola")).toBeNull();
    expect(parseClaimPhrase("mira esto: devi: recibir K7Q-4MX")).toBeNull(); // no está al inicio
    expect(parseClaimPhrase("devi: recibir K7Q-4M")).toBeNull(); // corto
    expect(parseClaimPhrase("devi: recibir K7Q-4MXZ")).toBeNull(); // largo
    expect(parseClaimPhrase("devi: recibir K0Q-4MX")).toBeNull(); // 0 no está en el alfabeto
  });

  test("límites", () => {
    expect(CLAIM_LIMITS).toEqual({ ttlMs: 600_000, maxOpenPerMember: 10 });
  });
});
