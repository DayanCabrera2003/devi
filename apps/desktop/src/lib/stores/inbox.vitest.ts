import { describe, expect, test } from "vitest";
import { draft, req } from "../test-fixtures";
import { InboxStore, applyEvent, cardFor } from "./inbox.svelte";

describe("cardFor", () => {
  test("destinatario: solo mientras está pendiente", () => {
    expect(cardFor(req(), "m1")?.kind).toBe("request");
    expect(cardFor(req({ status: "forwarded" }), "m1")).toBeNull();
    expect(cardFor(req({ status: "rejected" }), "m1")).toBeNull();
  });

  test("remitente: respuesta o timeout", () => {
    const mine = { fromMemberId: "m1", toMemberId: "m2" };
    expect(cardFor(req({ ...mine, status: "pending" }), "m1")).toBeNull();
    expect(cardFor(req({ ...mine, status: "answered", outcome: "answered" }), "m1")?.kind).toBe("response");
    expect(cardFor(req({ ...mine, status: "rejected", outcome: "rejected" }), "m1")?.kind).toBe("response");
    expect(cardFor(req({ ...mine, status: "timed_out" }), "m1")?.kind).toBe("timeout");
    expect(cardFor(req({ ...mine, status: "closed" }), "m1")).toBeNull();
  });
});

describe("applyEvent", () => {
  test("entra una solicitud y desaparece al reenviarla a una sesión", () => {
    let r = applyEvent([], { type: "request.incoming", request: req() }, "m1");
    expect(r.added?.key).toBe("request:q1");
    expect(r.cards).toHaveLength(1);
    r = applyEvent(r.cards, { type: "request.updated", request: req({ status: "forwarded" }) }, "m1");
    expect(r.cards).toHaveLength(0);
    expect(r.added).toBeNull();
  });

  test("repetir el mismo evento no duplica ni cuenta como nuevo", () => {
    const first = applyEvent([], { type: "request.incoming", request: req() }, "m1");
    const again = applyEvent(first.cards, { type: "request.incoming", request: req({ message: "editado" }) }, "m1");
    expect(again.cards).toHaveLength(1);
    expect(again.added).toBeNull();
    expect(again.cards[0]?.kind === "request" && again.cards[0].request.message).toBe("editado");
  });

  test("del timeout al reenvío: la tarjeta de timeout desaparece", () => {
    const mine = { fromMemberId: "m1", toMemberId: "m2" };
    let r = applyEvent([], { type: "request.timed_out", request: req({ ...mine, status: "timed_out" }) }, "m1");
    expect(r.cards[0]?.kind).toBe("timeout");
    r = applyEvent(r.cards, { type: "request.updated", request: req({ ...mine, status: "pending" }) }, "m1");
    expect(r.cards).toHaveLength(0);
  });

  test("borradores: awaiting añade, discarded quita", () => {
    let r = applyEvent([], { type: "draft.awaiting", draft: draft() }, "m1");
    expect(r.added?.key).toBe("draft:d1");
    r = applyEvent(r.cards, { type: "draft.discarded", draftId: "d1" }, "m1");
    expect(r.cards).toHaveLength(0);
  });

  test("team.updated y sessions.updated no tocan las tarjetas", () => {
    const base = applyEvent([], { type: "request.incoming", request: req() }, "m1").cards;
    expect(applyEvent(base, { type: "team.updated" }, "m1").cards).toBe(base);
  });
});

describe("InboxStore", () => {
  test("pending, remove y clear", () => {
    const s = new InboxStore();
    s.apply({ type: "draft.awaiting", draft: draft() }, "m1");
    s.applyRequest(req(), "m1");
    expect(s.pending).toBe(2);
    s.remove("draft:d1");
    expect(s.pending).toBe(1);
    s.clear();
    expect(s.pending).toBe(0);
  });
});
