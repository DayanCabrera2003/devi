import { describe, expect, test } from "bun:test";
import { migrate, openDb } from "../../core/db";
import { type DraftRecord, type RequestRecord, RequestsStore, requestsMigrations } from "./store";

function setup() {
  const db = openDb();
  migrate(db, "requests", requestsMigrations);
  return new RequestsStore(db);
}

const draft = (over: Partial<DraftRecord> = {}): DraftRecord => ({
  id: "d1", kind: "request", authorMemberId: "a", authorSessionId: "s1", authorSessionName: "frontend",
  toMemberId: "b", requestId: null, message: "hola", status: "awaiting", createdAt: 1, expiresAt: 2, ...over,
});

const request = (over: Partial<RequestRecord> = {}): RequestRecord => ({
  id: "q1", fromMemberId: "a", fromSessionId: "s1", fromSessionName: "frontend", toMemberId: "b", message: "hola",
  status: "pending", forwardedSessionId: null, outcome: null, outcomeText: null, createdAt: 1, sentAt: 1, deadline: 10,
  ...over,
});

describe("RequestsStore", () => {
  test("borradores: guardar, leer, cambiar estado", () => {
    const s = setup();
    s.insertDraft(draft());
    expect(s.getDraft("d1")).toEqual(draft());
    s.setDraftStatus("d1", "authorized");
    expect(s.getDraft("d1")?.status).toBe("authorized");
    expect(s.awaitingDrafts()).toEqual([]);
  });

  test("un borrador de solicitud necesita destinatario; uno de respuesta, solicitud", () => {
    const s = setup();
    expect(() => s.insertDraft(draft({ toMemberId: null }))).toThrow();
    expect(() => s.insertDraft(draft({ kind: "response", toMemberId: null, requestId: null }))).toThrow();
  });

  test("como máximo un borrador de respuesta esperando por solicitud", () => {
    const s = setup();
    const resp = (id: string) => draft({ id, kind: "response", toMemberId: null, requestId: "q1" });
    s.insertDraft(resp("r1"));
    expect(() => s.insertDraft(resp("r2"))).toThrow();
    s.setDraftStatus("r1", "discarded");
    s.insertDraft(resp("r2"));
    expect(s.awaitingResponseDraft("q1")?.id).toBe("r2");
  });

  test("solicitudes: guardar y actualizar", () => {
    const s = setup();
    s.insertRequest(request());
    const r = { ...s.getRequest("q1")!, status: "forwarded" as const, forwardedSessionId: "s9", deadline: 99 };
    s.saveRequest(r);
    expect(s.getRequest("q1")).toEqual(r);
    expect(s.openRequests().map((x) => x.id)).toEqual(["q1"]);
  });

  test("tarjetas: pendientes para B; respuestas y timeouts para A", () => {
    const s = setup();
    s.insertRequest(request({ id: "p", status: "pending", createdAt: 1 }));
    s.insertRequest(request({ id: "f", status: "forwarded", createdAt: 2 }));
    s.insertRequest(request({ id: "a", status: "answered", outcome: "answered", createdAt: 3 }));
    s.insertRequest(request({ id: "t", status: "timed_out", createdAt: 4 }));
    s.insertRequest(request({ id: "c", status: "closed", createdAt: 5 }));
    expect(s.cardsFor("b").map((r) => r.id)).toEqual(["p"]);
    expect(s.cardsFor("a").map((r) => r.id)).toEqual(["a", "t"]);
  });
});
