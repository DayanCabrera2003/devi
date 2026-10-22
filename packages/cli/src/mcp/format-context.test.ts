import { expect, test } from "bun:test";
import { hasUntrustedFrame } from "@devi/protocol";
import { formatRequest } from "./format";

const base = {
  id: "q1", origin: "session" as const, fromMemberId: "m2", fromSessionId: "s2", fromSessionName: "api", toMemberId: "m1",
  message: "¿Lo miras?", status: "pending" as const, files: [], responseFiles: [], createdAt: 1, sentAt: 1, deadline: 10_000_000,
};
const ctx = { meId: "m1", names: new Map([["m2", "María"]]), now: 2, sessionId: null, receivedDir: "/r" };

test("get_request y get_conversation muestran el contexto del compañero encuadrado", () => {
  const out = formatRequest({ ...base, context: { urgency: "alta", git: { branch: "feat/x" } } }, ctx, true);
  const section = out.slice(out.indexOf("- Contexto"));
  expect(section).toContain("Rama: feat/x");
  expect(section).toContain("Urgencia: alta");
  expect(hasUntrustedFrame(section)).toBe(true);
  expect(formatRequest(base, ctx, true)).not.toContain("Contexto");
});
