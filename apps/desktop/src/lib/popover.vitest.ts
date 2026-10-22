import { describe, expect, test } from "vitest";
import { cardHeading, popoverTitle } from "./popover";
import type { Card } from "./stores/inbox.svelte";
import { draft, req } from "./test-fixtures";

const nameOf = (id: string) => ({ m1: "Dayan", m2: "María" })[id] ?? id;

describe("panel de avisos", () => {
  test("título según lo que espera", () => {
    expect(popoverTitle(0)).toBe("Todo tranquilo");
    expect(popoverTitle(1)).toBe("1 cosa te espera");
    expect(popoverTitle(3)).toBe("3 cosas te esperan");
  });

  test("cada tarjeta dice de quién es y lleva a su conversación", () => {
    const r = req();
    const mine = req({ id: "q7", fromMemberId: "m1", toMemberId: "m2" });
    const cards: Card[] = [
      { kind: "request", key: "request:q1", request: r },
      { kind: "response", key: "response:q7", request: mine },
      { kind: "timeout", key: "timeout:q7", request: mine },
      { kind: "draft", key: "draft:d1", draft: draft() },
      { kind: "draft", key: "draft:d2", draft: draft({ id: "d2", kind: "response", requestId: "zz" }) },
    ];
    const out = cards.map((c) => cardHeading(c, nameOf, () => undefined));
    expect(out).toEqual([
      { title: "María te pide", memberId: "m2" },
      { title: "Respuesta de María", memberId: "m2" },
      { title: "María no contestó", memberId: "m2" },
      { title: "Tu agente → María", memberId: "m2" },
      { title: "Tu agente quiere responder", memberId: "@agente" },
    ]);
  });
});
