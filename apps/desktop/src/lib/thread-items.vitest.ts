import { describe, expect, test } from "vitest";
import { draft, req } from "./test-fixtures";
import type { Card } from "./stores/inbox.svelte";
import { AGENT_THREAD, buildThreadItems, originLabel, requestCaption, waitingByPeer } from "./thread-items";

const H = 3_600_000;
const day = new Date(2026, 9, 21, 10, 0).getTime();

describe("hilo: elementos y estados", () => {
  test("mezcla el hilo con las tarjetas abiertas, pone separadores y los borradores al final", () => {
    const old = req({ id: "a", createdAt: day - 26 * H, sentAt: day - 26 * H, status: "answered", outcome: "answered" });
    const pending = req({ id: "b", createdAt: day, sentAt: day });
    const cards: Card[] = [
      { kind: "request", key: "request:b", request: pending },
      { kind: "draft", key: "draft:d1", draft: draft({ createdAt: day + 60_000 }) },
    ];
    const items = buildThreadItems({ memberId: "m2", requests: [old], cards, lookup: () => undefined, now: day + H });
    expect(items.map((i) => i.kind)).toEqual(["day", "request", "day", "request", "draft"]);
    const b = items.find((i) => i.kind === "request" && i.request.id === "b");
    expect(b?.kind === "request" && b.card?.kind).toBe("request");
    expect(items[2]?.kind === "day" && items[2].label).toMatch(/^Hoy /);
  });

  test("un borrador de respuesta sin solicitud conocida va a la conversación del agente", () => {
    const orphan = draft({ id: "d9", kind: "response", requestId: "zz" });
    const cards: Card[] = [{ kind: "draft", key: "draft:d9", draft: orphan }];
    expect(waitingByPeer(cards, () => undefined)).toEqual({ [AGENT_THREAD]: 1 });
    expect(buildThreadItems({ memberId: AGENT_THREAD, requests: [], cards, lookup: () => undefined, now: 0 }).at(-1)?.kind).toBe("draft");
  });

  test("estados bajo la burbuja", () => {
    const mine = { fromMemberId: "m1", toMemberId: "m2" };
    expect(requestCaption(req({ ...mine }), "m1").text).toMatch(/^Enviado · /);
    expect(requestCaption(req(), "m1").text).toMatch(/^Recibido · /);
    expect(requestCaption(req({ ...mine, status: "forwarded" }), "m1").text).toMatch(/^En su sesión/);
    expect(requestCaption(req({ ...mine, status: "rejected", outcome: "rejected", outcomeText: "no puedo" }), "m1")).toMatchObject({ tone: "bad" });
    expect(requestCaption(req({ ...mine, status: "rejected", outcome: "rejected", outcomeText: "no puedo" }), "m1").text).toMatch(/^Rechazado: no puedo/);
    expect(requestCaption(req({ ...mine, status: "timed_out" }), "m1").text).toMatch(/^Sin respuesta/);
  });

  test("escalado: sin respuesta todavía (aviso) y la original reenviada a otra persona", () => {
    const mine = { fromMemberId: "m1", toMemberId: "m2" };
    expect(requestCaption(req({ ...mine, escalatedAt: 5 }), "m1")).toMatchObject({ tone: "warn" });
    expect(requestCaption(req({ ...mine, escalatedAt: 5 }), "m1").text).toMatch(/^Sin respuesta todavía · /);
    expect(requestCaption(req({ escalatedAt: 5 }), "m1").text).toMatch(/^Recibido · /); // al destinatario no
    expect(requestCaption(req({ ...mine, status: "closed", closedNote: "Reenviada a Leo" }), "m1").text).toMatch(/^Reenviada a Leo · /);
    expect(requestCaption(req({ ...mine, status: "closed" }), "m1").text).toMatch(/^Cerrada · /);
  });

  test("las solicitudes enviadas desde la app dicen 'desde la app'", () => {
    expect(originLabel(req({ origin: "app", fromSessionName: "" }))).toBe("desde la app");
    expect(originLabel(req())).toBe("desde «backend»");
  });
});
