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

import { API } from "./api";
import { UserEventSchema } from "./events";

describe("rutas de códigos", () => {
  test("crear y cancelar son de persona; canjear y listar no", () => {
    expect(API.createClaim).toMatchObject({ method: "POST", path: "/api/v1/claims", human: true });
    expect(API.cancelClaim).toMatchObject({ method: "DELETE", path: "/api/v1/claims/:code", human: true });
    expect(API.myClaims).toMatchObject({ method: "GET", path: "/api/v1/claims" });
    expect(API.redeemClaim).toMatchObject({ method: "POST", path: "/api/v1/claims/redeem" });
    expect("human" in API.redeemClaim).toBe(false);
    expect("human" in API.myClaims).toBe(false);
  });

  test("redeemClaim exige el emparejamiento de la sesión", () => {
    const ok = API.redeemClaim.body.safeParse({ code: "K7Q4MX", claudeSessionId: "c1", parentPid: 10, machine: "M1" });
    expect(ok.success).toBe(true);
    expect(API.redeemClaim.body.safeParse({ code: "K7Q4MX" }).success).toBe(false);
  });

  test("evento claim.updated", () => {
    const ev = { type: "claim.updated", claim: { code: "K7Q4MX", target: { type: "chat", id: "x" }, expiresAt: 1, status: "used" } };
    expect(UserEventSchema.safeParse(ev).success).toBe(true);
  });
});
