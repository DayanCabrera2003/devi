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
