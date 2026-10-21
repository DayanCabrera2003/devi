import { expect, test } from "bun:test";
import { SessionDeliverySchema, UserEventSchema } from "./events";

test("UserEvent discrimina por type", () => {
  expect(UserEventSchema.parse({ type: "team.updated" }).type).toBe("team.updated");
  expect(UserEventSchema.parse({ type: "draft.discarded", draftId: "d1" }).type).toBe("draft.discarded");
  expect(() => UserEventSchema.parse({ type: "nope" })).toThrow();
});

test("SessionDelivery", () => {
  const d = SessionDeliverySchema.parse({ kind: "draft_authorized", content: "salió", meta: { draft_id: "d1" } });
  expect(d.kind).toBe("draft_authorized");
});

test("audit.alert lleva una entrada de auditoría", () => {
  const entry = { id: 1, at: 1, actorLogin: "a@x.com", action: "role.updated", targetType: "role", targetId: "r1", details: {} };
  expect(UserEventSchema.parse({ type: "audit.alert", entry }).type).toBe("audit.alert");
  expect(() => UserEventSchema.parse({ type: "audit.alert", entry: { ...entry, action: "nope" } })).toThrow();
});
