import { describe, expect, test } from "bun:test";
import { CreateDraftMeta } from "./api";
import { DeviRequestSchema, DraftSchema, RequestKindSchema } from "./entities";

const REQ = {
  id: "q1", fromMemberId: "m1", fromSessionId: "s1", fromSessionName: "api", toMemberId: "m2", message: "hola",
  status: "pending", files: [], responseFiles: [], createdAt: 1, sentAt: 1, deadline: 2,
};

describe("traspaso de sesión (kind handoff)", () => {
  test("DeviRequest lleva kind request|handoff; sin él (servidor anterior) es request", () => {
    expect(RequestKindSchema.options).toEqual(["request", "handoff"]);
    expect(DeviRequestSchema.parse(REQ).kind).toBe("request");
    expect(DeviRequestSchema.parse({ ...REQ, kind: "handoff" }).kind).toBe("handoff");
    expect(DeviRequestSchema.safeParse({ ...REQ, kind: "orden" }).success).toBe(false);
  });

  test("CreateDraftMeta: una solicitud puede ser un traspaso (requestKind, por defecto request)", () => {
    const req = { kind: "request", sessionId: "s1", to: "m2", message: "hola" };
    expect(CreateDraftMeta.parse(req)).toMatchObject({ requestKind: "request" });
    expect(CreateDraftMeta.parse({ ...req, requestKind: "handoff" })).toMatchObject({ requestKind: "handoff" });
    expect(CreateDraftMeta.safeParse({ ...req, requestKind: "orden" }).success).toBe(false);
  });

  test("el borrador de una solicitud dice si es un traspaso (por defecto request)", () => {
    const d = {
      id: "d1", kind: "request", toMemberId: "m2", authorMemberId: "m1", authorSessionId: "s1", message: "hola",
      status: "awaiting", files: [], createdAt: 1, expiresAt: 2,
    };
    expect(DraftSchema.parse(d)).toMatchObject({ requestKind: "request" });
    expect(DraftSchema.parse({ ...d, requestKind: "handoff" })).toMatchObject({ requestKind: "handoff" });
  });
});
