import { describe, expect, test } from "bun:test";
import { API } from "./api";
import { AUDIT_ACTIONS } from "./audit";
import { ConversationQuery, ConversationSummarySchema, ConversationsResponseSchema, ConversationPageSchema, SendFromAppMeta } from "./conversations";
import { DeviRequestSchema } from "./entities";
import { UserEventSchema } from "./events";

const REQ = {
  id: "q1", fromMemberId: "m1", fromSessionId: "", fromSessionName: "", toMemberId: "m2", message: "hola",
  status: "pending", files: [], responseFiles: [], createdAt: 1, sentAt: 1, deadline: 2,
};

describe("envío desde la app", () => {
  test("POST /requests es humana, pide requests.send y devuelve la solicitud", () => {
    expect(API.sendFromApp).toMatchObject({ method: "POST", path: "/api/v1/requests", perm: "requests.send", human: true });
    expect(API.sendFromApp.response).toBe(DeviRequestSchema);
    expect(SendFromAppMeta.parse({ to: "m2", message: " hola " })).toEqual({ to: "m2", message: "hola" });
    expect(SendFromAppMeta.safeParse({ to: "m2", message: "  " }).success).toBe(false);
    expect(SendFromAppMeta.safeParse({ message: "hola" }).success).toBe(false);
    expect(AUDIT_ACTIONS).toContain("request.sent_from_app");
  });

  test("DeviRequest lleva origin; sin él (servidor anterior) es session", () => {
    expect(DeviRequestSchema.parse({ ...REQ, origin: "app" }).origin).toBe("app");
    expect(DeviRequestSchema.parse(REQ).origin).toBe("session");
    expect(DeviRequestSchema.safeParse({ ...REQ, origin: "cli" }).success).toBe(false);
  });
});

describe("conversaciones", () => {
  test("rutas de lectura, sin permiso ni Origin obligatorio", () => {
    expect(API.conversations).toMatchObject({ method: "GET", path: "/api/v1/conversations", perm: null });
    expect(API.conversation).toMatchObject({ method: "GET", path: "/api/v1/conversations/:memberId", perm: null });
    expect("human" in API.conversations).toBe(false);
    expect("human" in API.conversation).toBe(false);
    expect(API.conversations.response).toBe(ConversationsResponseSchema);
    expect(API.conversation.response).toBe(ConversationPageSchema);
  });

  test("resumen y página", () => {
    const s = { memberId: "m2", lastAt: null, lastPreview: null, lastFromMe: false, waitingOnMe: 0 };
    expect(ConversationSummarySchema.parse(s)).toEqual(s);
    expect(ConversationsResponseSchema.parse({ items: [s] }).items).toHaveLength(1);
    const page = ConversationPageSchema.parse({ requests: [{ ...REQ, origin: "app" }], nextBefore: 5 });
    expect(page.nextBefore).toBe(5);
    expect(ConversationPageSchema.parse({ requests: [] }).nextBefore).toBeUndefined();
  });

  test("query: limit 1..100 (30 por defecto) y before opcional", () => {
    expect(ConversationQuery.parse({})).toEqual({ limit: 30 });
    expect(ConversationQuery.parse({ limit: "10", before: "99" })).toEqual({ limit: 10, before: 99 });
    expect(ConversationQuery.safeParse({ limit: "0" }).success).toBe(false);
    expect(ConversationQuery.safeParse({ limit: "101" }).success).toBe(false);
  });

  test("evento conversation.updated", () => {
    expect(UserEventSchema.parse({ type: "conversation.updated", memberId: "m2" })).toEqual({ type: "conversation.updated", memberId: "m2" });
    expect(() => UserEventSchema.parse({ type: "conversation.updated" })).toThrow();
  });
});
