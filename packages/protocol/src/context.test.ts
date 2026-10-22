import { describe, expect, test } from "bun:test";
import { contextText, hasContext, RequestContextSchema } from "./context";
import { DeviRequestSchema, DraftSchema } from "./entities";
import { CreateDraftMeta } from "./api";
import { CONTEXT_LIMITS } from "./limits";

describe("contexto de una solicitud", () => {
  test("todos los campos son opcionales", () => {
    expect(RequestContextSchema.parse({})).toEqual({});
    const full = {
      summary: "El login falla en staging", tried: "Reiniciar el pod", error: "TypeError: x is undefined", urgency: "alta" as const,
      git: { branch: "feat/login", commit: "a1b2c3d Arregla el login", diffStat: " src/a.ts | 2 +-\n 1 file changed" },
    };
    expect(RequestContextSchema.parse(full)).toEqual(full);
  });

  test("urgencia solo baja, normal o alta", () => {
    expect(() => RequestContextSchema.parse({ urgency: "urgente" })).toThrow();
  });

  test("respeta los límites de tamaño", () => {
    expect(() => RequestContextSchema.parse({ summary: "x".repeat(CONTEXT_LIMITS.textChars + 1) })).toThrow();
    expect(() => RequestContextSchema.parse({ error: "x".repeat(CONTEXT_LIMITS.errorChars + 1) })).toThrow();
    expect(() => RequestContextSchema.parse({ git: { branch: "x".repeat(CONTEXT_LIMITS.branchChars + 1) } })).toThrow();
    expect(() => RequestContextSchema.parse({ git: { diffStat: "x".repeat(CONTEXT_LIMITS.diffStatChars + 1) } })).toThrow();
  });

  test("la solicitud, el borrador y POST /drafts lo admiten como opcional", () => {
    const context = { urgency: "baja" as const };
    const r = {
      id: "q1", fromMemberId: "m1", fromSessionId: "s1", fromSessionName: "api", toMemberId: "m2", message: "hola",
      status: "pending", files: [], responseFiles: [], createdAt: 1, sentAt: 1, deadline: 2,
    };
    expect(DeviRequestSchema.parse(r).context).toBeUndefined();
    expect(DeviRequestSchema.parse({ ...r, context }).context).toEqual(context);
    const d = { id: "d1", kind: "request", toMemberId: "m2", authorMemberId: "m1", authorSessionId: "s1", message: "hola", status: "awaiting", files: [], createdAt: 1, expiresAt: 2 };
    expect(DraftSchema.parse({ ...d, context }).context).toEqual(context);
    const meta = CreateDraftMeta.parse({ kind: "request", sessionId: "s1", to: "m2", message: "hola", context });
    expect(meta.kind === "request" && meta.context).toEqual(context);
  });

  test("hasContext: vacío o sin campos útiles = no", () => {
    expect(hasContext(undefined)).toBe(false);
    expect(hasContext({})).toBe(false);
    expect(hasContext({ summary: "  " })).toBe(false);
    expect(hasContext({ git: {} })).toBe(false);
    expect(hasContext({ urgency: "normal" })).toBe(true);
    expect(hasContext({ git: { branch: "main" } })).toBe(true);
  });

  test("contextText: líneas legibles en español, solo los campos presentes", () => {
    const t = contextText({ summary: "Falla el login", urgency: "alta", git: { branch: "main", commit: "abc123 Algo", diffStat: " a.ts | 1 +" } });
    expect(t).toContain("Resumen: Falla el login");
    expect(t).toContain("Urgencia: alta");
    expect(t).toContain("Rama: main");
    expect(t).toContain("Último commit: abc123 Algo");
    expect(t).toContain("Cambios sin commit (git diff --stat):\n a.ts | 1 +");
    expect(t).not.toContain("Qué se intentó");
    expect(contextText({})).toBe("");
  });
});
