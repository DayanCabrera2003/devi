import { describe, expect, test } from "bun:test";
import { API, CreateDraftMeta } from "./api";
import { AUDIT_ACTIONS, AUDIT_TARGETS } from "./audit";
import { DraftSchema } from "./entities";
import { UserEventSchema } from "./events";
import { KNOWLEDGE_LIMITS, KnowledgeEntrySchema, KnowledgeQuery } from "./knowledge";

const entry = {
  id: "k1", requestId: "q1", question: "¿Cómo despliego en staging?", answer: "Con `make deploy-staging`.",
  askedBy: "m1", askedByName: "Dayan", answeredBy: "m2", answeredByName: "María", createdAt: 1,
};

describe("base de conocimiento del equipo", () => {
  test("GET /knowledge: lectura para cualquier miembro (también el MCP, sin Origin de la app)", () => {
    expect(API.searchKnowledge).toMatchObject({ method: "GET", path: "/api/v1/knowledge", perm: null, actor: "any" });
    expect("human" in API.searchKnowledge).toBe(false);
    expect(API.searchKnowledge.response.parse({ entries: [entry] }).entries[0]).toEqual(entry);
  });

  test("DELETE /knowledge/:id: acción humana (retirar), de quien respondió o de un admin", () => {
    expect(API.withdrawKnowledge).toMatchObject({ method: "DELETE", path: "/api/v1/knowledge/:id", perm: null, human: true });
  });

  test("la consulta: q opcional y acotada, limit con valor por defecto y máximo", () => {
    expect(KnowledgeQuery.parse({})).toEqual({ q: "", limit: KNOWLEDGE_LIMITS.defaultPage });
    expect(KnowledgeQuery.parse({ q: " deploy ", limit: "5" })).toEqual({ q: "deploy", limit: 5 });
    expect(KnowledgeQuery.safeParse({ limit: String(KNOWLEDGE_LIMITS.maxPage + 1) }).success).toBe(false);
    expect(KnowledgeQuery.safeParse({ q: "x".repeat(KNOWLEDGE_LIMITS.maxQuery + 1) }).success).toBe(false);
  });

  test("una entrada no lleva archivos", () => {
    expect(Object.keys(KnowledgeEntrySchema.shape)).not.toContain("files");
  });

  test("responder con shareWithTeam: opcional en el borrador de respuesta y al aceptar en la app", () => {
    const res = { kind: "response", sessionId: "s1", requestId: "q1", message: "ok" };
    expect(CreateDraftMeta.parse(res)).toMatchObject({ shareWithTeam: false });
    expect(CreateDraftMeta.parse({ ...res, shareWithTeam: true })).toMatchObject({ shareWithTeam: true });
    expect(API.acceptRequest.body.parse({ note: "hecho", shareWithTeam: true })).toEqual({ note: "hecho", shareWithTeam: true });
    expect(API.acceptRequest.body.parse({})).toEqual({});
    const draft = {
      id: "d1", kind: "response", requestId: "q1", authorMemberId: "m2", authorSessionId: "s2", message: "ok",
      status: "awaiting", files: [], createdAt: 1, expiresAt: 2,
    };
    expect(DraftSchema.parse({ ...draft, shareWithTeam: true })).toMatchObject({ shareWithTeam: true });
    expect(DraftSchema.parse(draft)).not.toHaveProperty("shareWithTeam");
  });

  test("eventos de la app: guardada o rechazada (con los motivos)", () => {
    expect(UserEventSchema.parse({ type: "knowledge.saved", entry }).type).toBe("knowledge.saved");
    const refused = { type: "knowledge.refused" as const, requestId: "q1", reasons: ["Token de GitHub (ghp_…)"] };
    expect(UserEventSchema.parse(refused)).toEqual(refused);
  });

  test("auditoría: compartir y retirar", () => {
    expect(AUDIT_ACTIONS).toContain("knowledge.shared");
    expect(AUDIT_ACTIONS).toContain("knowledge.withdrawn");
    expect(AUDIT_TARGETS).toContain("knowledge");
  });
});
