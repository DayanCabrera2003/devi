import { describe, expect, test } from "bun:test";
import { fakeServer, sseResponse } from "./fake-server";
import { subscribeSse, type SseFrame, type SseStatus } from "./sse";

describe("subscribeSse", () => {
  test("reconecta cuando el stream se cierra y avisa del estado", async () => {
    let connections = 0;
    const srv = fakeServer(() => {
      connections++;
      return sseResponse([{ event: "deliver", data: { n: connections } }], true);
    });
    const frames: SseFrame[] = [];
    const statuses: SseStatus[] = [];
    const stop = subscribeSse({
      url: `${srv.url}/s`, headers: {}, fetch: (u, i) => fetch(u, i),
      onFrame: (f) => frames.push(f), onStatus: (s) => statuses.push(s), baseDelayMs: 10, maxDelayMs: 20,
    });
    await Bun.sleep(150);
    stop();
    srv.stop();
    expect(connections).toBeGreaterThanOrEqual(3);
    expect(frames[0]).toEqual({ event: "deliver", data: '{"n":1}' });
    expect(statuses.slice(0, 3)).toEqual(["connecting", "open", "reconnecting"]);
  });

  test("reintenta si el servidor responde con error", async () => {
    let connections = 0;
    const srv = fakeServer(() => {
      connections++;
      return new Response("caído", { status: 503 });
    });
    const statuses: SseStatus[] = [];
    const stop = subscribeSse({
      url: `${srv.url}/s`, headers: {}, fetch: (u, i) => fetch(u, i),
      onFrame: () => {}, onStatus: (s) => statuses.push(s), baseDelayMs: 10, maxDelayMs: 20,
    });
    await Bun.sleep(100);
    stop();
    srv.stop();
    expect(connections).toBeGreaterThanOrEqual(2);
    expect(statuses).not.toContain("open");
  });

  test("no reconecta después de cancelar", async () => {
    let connections = 0;
    const srv = fakeServer((req) => {
      connections++;
      return sseResponse([], false, req.signal);
    });
    const stop = subscribeSse({
      url: `${srv.url}/s`, headers: {}, fetch: (u, i) => fetch(u, i), onFrame: () => {}, baseDelayMs: 10, maxDelayMs: 20,
    });
    await Bun.sleep(50);
    stop();
    await Bun.sleep(100);
    srv.stop();
    expect(connections).toBe(1);
  });
});
