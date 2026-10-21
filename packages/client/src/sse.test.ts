import { describe, expect, test } from "bun:test";
import { backoffDelay, createSseParser, type SseFrame } from "./sse";

describe("createSseParser", () => {
  test("separa frames, ignora comentarios y une varias líneas data", () => {
    const frames: SseFrame[] = [];
    const push = createSseParser((f) => frames.push(f));
    push(": connected\n\nevent: team.updated\ndata: {\"type\":");
    expect(frames).toEqual([]);
    push("\"team.updated\"}\n\n: ping\n\ndata: a\ndata: b\n\n");
    expect(frames).toEqual([
      { event: "team.updated", data: '{"type":"team.updated"}' },
      { event: "message", data: "a\nb" },
    ]);
  });

  test("acepta \\r\\n y campos sin espacio tras los dos puntos", () => {
    const frames: SseFrame[] = [];
    const push = createSseParser((f) => frames.push(f));
    push("event:deliver\r\ndata:{}\r\n\r\n");
    expect(frames).toEqual([{ event: "deliver", data: "{}" }]);
  });
});

test("backoffDelay crece exponencialmente hasta el máximo", () => {
  expect([0, 1, 2, 3, 4, 5, 6].map((n) => backoffDelay(n, 1000, 30_000))).toEqual([
    1000, 2000, 4000, 8000, 16_000, 30_000, 30_000,
  ]);
});
