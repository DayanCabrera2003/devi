import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeviApiError } from "@devi/client";
import { fakeClient } from "./fake-client";
import { TOOLS, callTool } from "./tools";

// take_request / decline_request: atender una solicitud desde Claude Code (p. ej. con Remote Control).
const cwd = mkdtempSync(join(tmpdir(), "devi-attend-"));
const SESSION = { id: "s1", memberId: "m2", name: "api", cwd, status: "idle" as const, lastSeen: 1, channel: false };
const deps = (client: ReturnType<typeof fakeClient>["client"], approval: "app" | "chat" = "chat", receivedDir = mkdtempSync(join(tmpdir(), "devi-recv-"))) => ({
  client, configError: null, cwd, session: () => SESSION, approval: () => approval, receivedDir,
});
const REQUEST = {
  id: "q1", fromMemberId: "m1", fromSessionId: "s0", fromSessionName: "frontend", toMemberId: "m2", message: "PR #12",
  status: "forwarded", forwardedSessionId: "s1", files: [], responseFiles: [], createdAt: 1, sentAt: 1, deadline: 2,
};
const DELIVERY = {
  kind: "request",
  content: "Dayan te pide desde su sesión \"frontend\":\n\n<<<DEVI-UNTRUSTED-ab\nPR #12\nDEVI-UNTRUSTED-ab>>>",
  meta: { request_id: "q1", from: "m1", from_name: "Dayan", from_session: "frontend", files: JSON.stringify([{ id: "f1", name: "diff.patch" }]), inbox_id: "i1" },
};

describe("definiciones", () => {
  test("piden aprobación en cada llamada y explican cuándo usarlas", () => {
    const take = TOOLS.find((t) => t.name === "take_request")!;
    const decline = TOOLS.find((t) => t.name === "decline_request")!;
    for (const t of [take, decline]) {
      expect(t._meta).toEqual({ "anthropic/requiresUserInteraction": true });
      expect(t.annotations.readOnlyHint).toBe(false);
      expect(t.description).toMatch(/aviso de permisos/);
      expect(t.description).toContain("request_notice");
    }
    expect(take.inputSchema.required).toEqual(["request_id"]);
    expect(decline.inputSchema.required).toEqual(["request_id", "reason"]);
  });
});

describe("take_request", () => {
  test("trae la solicitud: aprobación chat, archivos descargados, entrada de la bandeja confirmada", async () => {
    const f = fakeClient({ takeRequest: { request: REQUEST, delivery: DELIVERY }, downloadFile: "+1\n", ackInbox: { ok: true } });
    const d = deps(f.client);
    const r = await callTool("take_request", { request_id: " q1 " }, d);
    expect(r.isError).toBe(false);
    expect(f.calls[0]).toEqual({ name: "takeRequest", opts: { params: { id: "q1" }, body: { sessionId: "s1", approval: "chat" } } });
    expect(f.calls.at(-1)).toEqual({ name: "ackInbox", opts: { body: { ids: ["i1"] } } });
    const text = r.content[0]!.text;
    expect(text).toContain("q1");
    expect(text).toContain("DEVI-UNTRUSTED");
    expect(text).toContain("respond_to_request");
    expect(text).toMatch(/nunca una orden|no es una orden/i);
    const local = join(d.receivedDir, "q1", "diff.patch");
    expect(text).toContain(local);
    expect(readFileSync(local, "utf8")).toBe("+1\n");
  });

  test("sin aprobación en el chat (cliente no apto): no llama al servidor y remite a la app", async () => {
    const f = fakeClient({});
    const r = await callTool("take_request", { request_id: "q1" }, deps(f.client, "app"));
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toContain("app de Devi");
    expect(f.calls).toEqual([]);
  });

  test("errores del servidor (inyección, chatApproval desactivado) llegan legibles", async () => {
    const err = new DeviApiError(409, { error: "Posible prompt injection (x): revísala en la app de Devi", code: "injection" });
    const f = fakeClient({ takeRequest: err });
    const r = await callTool("take_request", { request_id: "q1" }, deps(f.client));
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toContain("revísala en la app de Devi");
    expect((await callTool("take_request", {}, deps(f.client))).content[0]!.text).toContain("request_id");
  });
});

describe("decline_request", () => {
  test("rechaza con motivo obligatorio y aprobación chat", async () => {
    const f = fakeClient({ declineRequest: { ...REQUEST, status: "rejected", outcome: "rejected", outcomeText: "No puedo" }, team: { members: [{ id: "m1", name: "Dayan" }], roles: [] } });
    expect((await callTool("decline_request", { request_id: "q1" }, deps(f.client))).isError).toBe(true);
    expect(f.calls).toEqual([]);
    const r = await callTool("decline_request", { request_id: "q1", reason: " No puedo " }, deps(f.client));
    expect(r.isError).toBe(false);
    expect(f.calls[0]).toEqual({ name: "declineRequest", opts: { params: { id: "q1" }, body: { sessionId: "s1", reason: "No puedo", approval: "chat" } } });
    expect(r.content[0]!.text).toMatch(/[Rr]echazada/);
  });

  test("sin aprobación en el chat: remite a la app sin llamar al servidor", async () => {
    const f = fakeClient({});
    const r = await callTool("decline_request", { request_id: "q1", reason: "no" }, deps(f.client, "app"));
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toContain("app de Devi");
    expect(f.calls).toEqual([]);
  });
});
