import { describe, expect, test } from "vitest";
import { type MoodInput, SLEEP_AFTER_MS, deriveMood, overdueCount, quietSinceAfter } from "./mood";
import type { Card } from "./stores/inbox.svelte";
import { req } from "./test-fixtures";

const NOW = 1_000_000_000;
const base: MoodInput = { online: true, pending: 0, overdue: 0, cheering: false, quietSince: NOW, now: NOW };

describe("deriveMood", () => {
  test("tranquila por defecto", () => {
    expect(deriveMood(base)).toBe("calm");
  });

  test("atenta con pendientes", () => {
    expect(deriveMood({ ...base, pending: 2, quietSince: null })).toBe("attentive");
  });

  test("inquieta si algo venció, aunque haya más pendientes", () => {
    expect(deriveMood({ ...base, pending: 3, overdue: 1, quietSince: null })).toBe("uneasy");
  });

  test("contenta un momento al llegar una respuesta, por encima de inquieta", () => {
    expect(deriveMood({ ...base, pending: 1, overdue: 1, cheering: true })).toBe("happy");
  });

  test("dormida tras un rato sin pendientes; antes no", () => {
    expect(deriveMood({ ...base, now: NOW + SLEEP_AFTER_MS - 1 })).toBe("calm");
    expect(deriveMood({ ...base, now: NOW + SLEEP_AFTER_MS })).toBe("sleeping");
    expect(deriveMood({ ...base, quietSince: null, now: NOW + SLEEP_AFTER_MS * 10 })).toBe("calm");
  });

  test("sin conexión manda sobre todo lo demás", () => {
    expect(deriveMood({ ...base, online: false, pending: 1, overdue: 1, cheering: true })).toBe("offline");
  });
});

describe("overdueCount", () => {
  test("cuenta las solicitudes mías sin respuesta a tiempo y las que me piden con el plazo vencido", () => {
    const cards: Card[] = [
      { kind: "timeout", key: "timeout:a", request: req({ id: "a", status: "timed_out" }) },
      { kind: "request", key: "request:b", request: req({ id: "b", deadline: NOW - 1 }) },
      { kind: "request", key: "request:c", request: req({ id: "c", deadline: NOW + 60_000 }) },
      { kind: "response", key: "response:d", request: req({ id: "d", status: "answered", deadline: NOW - 1 }) },
    ];
    expect(overdueCount(cards, NOW)).toBe(2);
    expect(overdueCount([], NOW)).toBe(0);
  });
});

describe("quietSinceAfter", () => {
  test("con pendientes no hay calma; al quedarse sin ellos empieza a contar", () => {
    expect(quietSinceAfter(NOW - 5, 1, NOW, false)).toBeNull();
    expect(quietSinceAfter(null, 0, NOW, false)).toBe(NOW);
    expect(quietSinceAfter(NOW - 5, 0, NOW, false)).toBe(NOW - 5);
  });

  test("cualquier actividad la despierta: vuelve a contar desde ahora", () => {
    expect(quietSinceAfter(NOW - SLEEP_AFTER_MS * 2, 0, NOW, true)).toBe(NOW);
  });
});
