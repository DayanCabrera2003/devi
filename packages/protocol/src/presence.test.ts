import { expect, test } from "bun:test";
import { API } from "./api";
import { PRESENCE } from "./limits";

test("latido de presencia", () => {
  expect(API.heartbeat.method).toBe("POST");
  expect(API.heartbeat.path).toBe("/api/v1/presence/heartbeat");
  expect(API.heartbeat.body.safeParse({}).success).toBe(true);
  expect(API.heartbeat.body.safeParse({ sessionId: "s1" }).success).toBe(true);
  expect(PRESENCE.staleMs).toBeGreaterThan(2 * PRESENCE.heartbeatMs);
});
