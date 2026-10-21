import { describe, expect, test } from "vitest";
import type { Card } from "./stores/inbox.svelte";
import { noticeFor, noticeKey, shouldNotify } from "./notify";
import { draft, req } from "./test-fixtures";

const names: Record<string, string> = { m1: "Dayan", m2: "María" };
const nameOf = (id: string) => names[id] ?? id;

describe("notificaciones", () => {
  test("texto por tipo de tarjeta", () => {
    const r = req();
    const cards: Card[] = [
      { kind: "draft", key: "draft:d1", draft: draft() },
      { kind: "request", key: "request:q1", request: r },
      { kind: "response", key: "response:q1", request: req({ fromMemberId: "m1", toMemberId: "m2", status: "rejected", outcome: "rejected", outcomeText: "no tengo acceso" }) },
      { kind: "timeout", key: "timeout:q1", request: req({ fromMemberId: "m1", toMemberId: "m2", status: "timed_out" }) },
    ];
    expect(cards.map((c) => noticeFor(c, nameOf).title)).toEqual([
      "Devi · Claude quiere enviar algo",
      "Devi · María te pide algo",
      "Devi · Respuesta de María",
      "Devi · Sin respuesta de María",
    ]);
    expect(noticeFor(cards[2]!, nameOf).body).toBe("Rechazada: no tengo acceso");
  });

  test("el cuerpo se recorta", () => {
    const n = noticeFor({ kind: "request", key: "request:q1", request: req({ message: "x".repeat(500) }) }, nameOf);
    expect(n.body.length).toBeLessThanOrEqual(140);
  });

  test("un reenvío tras timeout es un aviso nuevo", () => {
    const a = noticeKey({ kind: "request", key: "request:q1", request: req({ sentAt: 1 }) });
    const b = noticeKey({ kind: "request", key: "request:q1", request: req({ sentAt: 2 }) });
    expect(a).not.toBe(b);
  });

  test("shouldNotify", () => {
    expect(shouldNotify({ notifications: true }, false)).toBe(true);
    expect(shouldNotify({ notifications: true }, true)).toBe(false);
    expect(shouldNotify({ notifications: false }, false)).toBe(false);
  });
});
