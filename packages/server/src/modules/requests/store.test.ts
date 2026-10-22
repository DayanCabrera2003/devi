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
  toMemberId: "b", requestId: null, message: "hola", status: "awaiting", createdAt: 1, expiresAt: 2, requestKind: "request", ...over,
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

describe("RequestsStore: origen y conversaciones", () => {
  function setupAt(now: { t: number }) {
    const db = openDb();
    migrate(db, "requests", requestsMigrations);
    return new RequestsStore(db, () => now.t);
  }

  test("origin: session por defecto; app se guarda y se lee", () => {
    const s = setup();
    s.insertRequest(request());
    s.insertRequest(request({ id: "q2", origin: "app", fromSessionId: "", fromSessionName: "" }));
    expect(s.getRequest("q1")?.origin).toBe("session");
    expect(s.getRequest("q2")).toMatchObject({ origin: "app", fromSessionId: "", fromSessionName: "" });
  });

  test("la migración 2 marca como session las solicitudes que ya existían", () => {
    const db = openDb();
    migrate(db, "requests", requestsMigrations.filter((m) => m.version === 1));
    db.run(`INSERT INTO requests (id, from_member, from_session, from_session_name, to_member, message, status, created_at, sent_at, deadline)
            VALUES ('old', 'a', 's1', 'frontend', 'b', 'hola', 'pending', 1, 1, 10)`);
    migrate(db, "requests", requestsMigrations);
    expect(new RequestsStore(db).getRequest("old")?.origin).toBe("session");
  });

  test("página de conversación: solo entre los dos, en ambos sentidos, de la más nueva a la más vieja", () => {
    const s = setup();
    s.insertRequest(request({ id: "ab1", createdAt: 1 }));
    s.insertRequest(request({ id: "ba", fromMemberId: "b", toMemberId: "a", createdAt: 2, status: "closed" }));
    s.insertRequest(request({ id: "ac", toMemberId: "c", createdAt: 3 }));
    s.insertRequest(request({ id: "cb", fromMemberId: "c", createdAt: 4 }));
    s.insertRequest(request({ id: "ab2", createdAt: 5 }));
    expect(s.conversationPage("a", "b", undefined, 30)).toEqual({ requests: [s.getRequest("ab2")!, s.getRequest("ba")!, s.getRequest("ab1")!] });
    expect(s.conversationPage("b", "a", undefined, 30).requests.map((r) => r.id)).toEqual(["ab2", "ba", "ab1"]);
    expect(s.conversationPage("a", "c", undefined, 30).requests.map((r) => r.id)).toEqual(["ac"]);
  });

  test("paginación con before; los empates de createdAt no se pierden", () => {
    const s = setup();
    for (const [id, createdAt] of [["r1", 10], ["r2", 20], ["r3", 20], ["r4", 30], ["r5", 40]] as const) {
      s.insertRequest(request({ id, createdAt }));
    }
    const p1 = s.conversationPage("a", "b", undefined, 2);
    expect(p1).toEqual({ requests: [s.getRequest("r5")!, s.getRequest("r4")!], nextBefore: 30 });
    // Página de 2 que partiría el empate de 20: se devuelve solo lo anterior al empate.
    const p2 = s.conversationPage("a", "b", 40, 2);
    expect(p2.requests.map((r) => r.id)).toEqual(["r4"]);
    expect(p2.nextBefore).toBe(30);
    const p3 = s.conversationPage("a", "b", 30, 1);
    // El empate entero no cabe: se devuelve completo.
    expect(p3.requests.map((r) => r.id).sort()).toEqual(["r2", "r3"]);
    expect(p3.nextBefore).toBe(20);
    expect(s.conversationPage("a", "b", 20, 5)).toEqual({ requests: [s.getRequest("r1")!] });
    expect(s.conversationPage("a", "b", 10, 5)).toEqual({ requests: [] });
  });

  test("última actividad: mensaje o respuesta, la más reciente, y quién la escribió", () => {
    const now = { t: 100 };
    const s = setupAt(now);
    expect(s.lastActivity("a", "b")).toBeNull();
    s.insertRequest(request({ id: "q1", message: "pregunta", sentAt: 10, createdAt: 10 }));
    expect(s.lastActivity("a", "b")).toEqual({ at: 10, text: "pregunta", byMemberId: "a" });
    now.t = 50;
    s.saveRequest({ ...s.getRequest("q1")!, status: "answered", outcome: "answered", outcomeText: "respuesta" });
    expect(s.lastActivity("b", "a")).toEqual({ at: 50, text: "respuesta", byMemberId: "b" });
    // Guardar otra vez (p. ej. al cerrar) no cambia cuándo se respondió.
    now.t = 70;
    s.saveRequest({ ...s.getRequest("q1")!, status: "closed" });
    expect(s.lastActivity("a", "b")?.at).toBe(50);
    s.insertRequest(request({ id: "q2", fromMemberId: "b", toMemberId: "a", message: "otra", sentAt: 60, createdAt: 60 }));
    expect(s.lastActivity("a", "b")).toEqual({ at: 60, text: "otra", byMemberId: "b" });
    now.t = 80;
    s.saveRequest({ ...s.getRequest("q2")!, status: "accepted", outcome: "accepted", outcomeText: null });
    expect(s.lastActivity("a", "b")).toEqual({ at: 80, text: "Aceptada", byMemberId: "a" });
  });

  test("lo que espera mi acción con una persona", () => {
    const s = setup();
    s.insertRequest(request({ id: "in-pending", fromMemberId: "b", toMemberId: "a", status: "pending" }));
    s.insertRequest(request({ id: "in-fwd", fromMemberId: "b", toMemberId: "a", status: "forwarded" }));
    s.insertRequest(request({ id: "out-answered", status: "answered", outcome: "answered" }));
    s.insertRequest(request({ id: "out-rejected", status: "rejected", outcome: "rejected" }));
    s.insertRequest(request({ id: "out-timeout", status: "timed_out" }));
    s.insertRequest(request({ id: "out-pending", status: "pending" }));
    s.insertRequest(request({ id: "out-closed", status: "closed" }));
    s.insertRequest(request({ id: "other", fromMemberId: "c", toMemberId: "a", status: "pending" }));
    s.insertDraft(draft({ id: "d-req", toMemberId: "b" }));
    s.insertDraft(draft({ id: "d-other", toMemberId: "c" }));
    s.insertDraft(draft({ id: "d-resp", kind: "response", toMemberId: null, requestId: "in-fwd" }));
    s.insertDraft(draft({ id: "d-old", toMemberId: "b", status: "discarded" }));
    // pending entrante + answered + rejected + timed_out + borrador de solicitud + borrador de respuesta
    expect(s.waitingOn("a", "b")).toBe(6);
    // Para b: solo out-pending (la suya pendiente espera a a; los borradores de a no cuentan).
    expect(s.waitingOn("b", "a")).toBe(1);
    expect(s.waitingOn("a", "c")).toBe(2);
  });
});
