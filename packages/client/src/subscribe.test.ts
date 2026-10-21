import { describe, expect, test } from "bun:test";
import { DeviApiError } from "./errors";
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

  test("un onFrame que lanza no reconecta ni deja la conexión abierta", async () => {
    let connections = 0;
    let aborted = 0;
    const srv = fakeServer((req) => {
      connections++;
      req.signal.addEventListener("abort", () => aborted++);
      return sseResponse([{ event: "deliver", data: 1 }, { event: "deliver", data: 2 }], false, req.signal);
    });
    const frames: SseFrame[] = [];
    const orig = console.error;
    console.error = () => {};
    const stop = subscribeSse({
      url: `${srv.url}/s`, headers: {}, fetch: (u, i) => fetch(u, i), baseDelayMs: 10, maxDelayMs: 20,
      onFrame: (f) => {
        frames.push(f);
        if (f.data === "1") throw new Error("boom");
      },
    });
    await Bun.sleep(100);
    stop();
    await Bun.sleep(30);
    console.error = orig;
    srv.stop();
    expect(frames.map((f) => f.data)).toEqual(["1", "2"]);
    expect(connections).toBe(1);
    expect(aborted).toBe(1); // se cerró solo por el stop()
  });

  test("el watchdog de inactividad aborta y reconecta", async () => {
    let connections = 0;
    const srv = fakeServer((req) => {
      connections++;
      return sseResponse([], false, req.signal); // solo ": connected" y silencio
    });
    const statuses: SseStatus[] = [];
    const stop = subscribeSse({
      url: `${srv.url}/s`, headers: {}, fetch: (u, i) => fetch(u, i), onFrame: () => {},
      onStatus: (s) => statuses.push(s), baseDelayMs: 10, maxDelayMs: 20, idleTimeoutMs: 100,
    });
    await Bun.sleep(450);
    stop();
    srv.stop();
    expect(connections).toBeGreaterThanOrEqual(2);
    expect(statuses.slice(0, 3)).toEqual(["connecting", "open", "reconnecting"]);
  });

  test("unsubscribe dentro de un handler corta el resto de frames del trozo", async () => {
    const srv = fakeServer(() => sseResponse([{ event: "d", data: 1 }, { event: "d", data: 2 }, { event: "d", data: 3 }], true));
    const got: string[] = [];
    let stop = () => {};
    stop = subscribeSse({
      url: `${srv.url}/s`, headers: {}, fetch: (u, i) => fetch(u, i), baseDelayMs: 10, maxDelayMs: 20,
      onFrame: (f) => {
        got.push(f.data);
        stop();
      },
    });
    await Bun.sleep(100);
    srv.stop();
    expect(got).toEqual(["1"]);
  });
});

describe("errores fatales", () => {
  for (const status of [401, 403, 426]) {
    test(`${status} da failed con el error y no reintenta`, async () => {
      let n = 0;
      const srv = fakeServer(() => {
        n++;
        return Response.json({ error: "x", code: "c" }, { status });
      });
      const got: [string, unknown][] = [];
      const stop = subscribeSse({
        url: `${srv.url}/e`, headers: {}, fetch: (u, i) => fetch(u, i), onFrame: () => {},
        onStatus: (s, err) => got.push([s, err]), baseDelayMs: 10, maxDelayMs: 20,
      });
      await Bun.sleep(150);
      stop();
      srv.stop();
      expect(n).toBe(1);
      expect(got.map((g) => g[0])).toEqual(["connecting", "failed"]);
      expect((got[1]![1] as DeviApiError).status).toBe(status);
    });
  }

  test("un 500 sigue reconectando", async () => {
    let n = 0;
    const srv = fakeServer(() => {
      n++;
      return new Response("x", { status: 500 });
    });
    const statuses: string[] = [];
    const stop = subscribeSse({
      url: `${srv.url}/e`, headers: {}, fetch: (u, i) => fetch(u, i), onFrame: () => {},
      onStatus: (s) => statuses.push(s), baseDelayMs: 10, maxDelayMs: 20,
    });
    await Bun.sleep(150);
    stop();
    srv.stop();
    expect(n).toBeGreaterThan(1);
    expect(statuses).not.toContain("failed");
  });
});
