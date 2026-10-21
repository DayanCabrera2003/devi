import { afterEach, describe, expect, test } from "bun:test";
import { API_VERSION, type AuditEntry, type SessionDelivery, type UserEvent } from "@devi/protocol";
import { createClient } from "./client";
import { DeviApiError } from "./errors";
import { fakeServer, sseResponse } from "./fake-server";
import type { SseStatus } from "./sse";

let stops: (() => void)[] = [];
afterEach(() => {
  for (const s of stops) s();
  stops = [];
});
function serve(handler: Parameters<typeof fakeServer>[0]) {
  const srv = fakeServer(handler);
  stops.push(srv.stop);
  return srv;
}

describe("suscripciones", () => {
  test("subscribeUser entrega eventos válidos y descarta los inválidos", async () => {
    const srv = serve((req) =>
      sseResponse(
        [
          { event: "team.updated", data: { type: "team.updated" } },
          { event: "team.updated", data: { type: "nope" } },
          { event: "sessions.updated", data: { type: "sessions.updated", memberId: "m1" } },
        ],
        false,
        req.signal,
      ),
    );
    const events: UserEvent[] = [];
    const statuses: SseStatus[] = [];
    const stop = createClient({ baseUrl: srv.url, devUser: "maria@dev" }).subscribeUser((e) => events.push(e), {
      onStatus: (s) => statuses.push(s),
    });
    await Bun.sleep(100);
    stop();
    expect(events).toEqual([{ type: "team.updated" }, { type: "sessions.updated", memberId: "m1" }]);
    expect(statuses).toEqual(["connecting", "open"]);
    const req = srv.seen[0]!;
    expect(req.path).toBe("/api/v1/events/user");
    expect(req.query.get("v")).toBe(API_VERSION);
    expect(req.query.get("devUser")).toBe("maria@dev");
    expect(req.headers.get("X-Devi-Version")).toBe(API_VERSION);
    expect(req.headers.get("X-Devi-Dev-User")).toBe("maria@dev");
  });

  test("subscribeUser entrega audit.alert con una entrada válida y descarta las mal formadas", async () => {
    const entry: AuditEntry = {
      id: 7, at: 1, actorMemberId: "m1", actorLogin: "dayan@x", action: "role.updated", targetType: "role", targetId: "r1", details: {},
    };
    const srv = serve((req) =>
      sseResponse(
        [
          { event: "audit.alert", data: { type: "audit.alert", entry } },
          { event: "audit.alert", data: { type: "audit.alert", entry: { ...entry, id: "7" } } },
          { event: "audit.alert", data: { type: "audit.alert", entry: { ...entry, action: "inventada" } } },
        ],
        false,
        req.signal,
      ),
    );
    const events: UserEvent[] = [];
    const stop = createClient({ baseUrl: srv.url }).subscribeUser((e) => events.push(e));
    await Bun.sleep(100);
    stop();
    expect(events).toEqual([{ type: "audit.alert", entry }]);
  });

  test("subscribeSession solo entrega frames 'deliver'", async () => {
    const delivery = { kind: "draft_authorized", content: "salió", meta: { draft_id: "d1" } };
    const srv = serve((req) =>
      sseResponse([{ event: "otro", data: delivery }, { event: "deliver", data: delivery }], false, req.signal),
    );
    const got: SessionDelivery[] = [];
    const stop = createClient({ baseUrl: srv.url }).subscribeSession("s 1", (d) => got.push(d));
    await Bun.sleep(100);
    stop();
    expect(got).toEqual([delivery as SessionDelivery]);
    expect(srv.seen[0]!.path).toBe("/api/v1/events/session/s%201");
  });

  test("subscribeUser reconecta tras una caída (espera inicial de 1 s)", async () => {
    let n = 0;
    const srv = serve((req, url) => {
      if (url.pathname === "/api/v1/presence/heartbeat") return Response.json({ ok: true });
      n++;
      return sseResponse([{ event: "team.updated", data: { type: "team.updated" } }], n === 1, req.signal);
    });
    const events: UserEvent[] = [];
    const statuses: SseStatus[] = [];
    const stop = createClient({ baseUrl: srv.url }).subscribeUser((e) => events.push(e), { onStatus: (s) => statuses.push(s) });
    await Bun.sleep(1300);
    stop();
    expect(n).toBe(2);
    expect(events.length).toBe(2);
    expect(statuses).toEqual(["connecting", "open", "reconnecting", "open"]);
  });

  const isBeat = (r: { path: string; method: string }) => r.path === "/api/v1/presence/heartbeat" && r.method === "POST";
  const beatsOf = (srv: { seen: { path: string; method: string }[] }) => srv.seen.filter(isBeat);

  test("subscribeUser manda heartbeat al conectar y cada heartbeatMs, y para al cancelar", async () => {
    const bodies: unknown[] = [];
    const srv = serve(async (req, url) => {
      if (url.pathname === "/api/v1/presence/heartbeat") {
        bodies.push(await req.json());
        return Response.json({ ok: true });
      }
      return sseResponse([], false, req.signal);
    });
    const stop = createClient({ baseUrl: srv.url, heartbeatMs: 50 }).subscribeUser(() => {});
    await Bun.sleep(230);
    stop();
    const n = beatsOf(srv).length;
    expect(n).toBeGreaterThanOrEqual(4);
    expect(bodies[0]).toEqual({});
    await Bun.sleep(150);
    expect(beatsOf(srv).length).toBe(n);
  });

  test("subscribeSession manda heartbeat con su sessionId", async () => {
    const bodies: unknown[] = [];
    const srv = serve(async (req, url) => {
      if (url.pathname === "/api/v1/presence/heartbeat") {
        bodies.push(await req.json());
        return Response.json({ ok: true });
      }
      return sseResponse([], false, req.signal);
    });
    const stop = createClient({ baseUrl: srv.url, heartbeatMs: 1000 }).subscribeSession("s1", () => {});
    await Bun.sleep(150);
    stop();
    expect(bodies).toEqual([{ sessionId: "s1" }]);
  });

  test("los errores del heartbeat se ignoran y el stream sigue", async () => {
    const srv = serve((req, url) => {
      if (url.pathname === "/api/v1/presence/heartbeat") return new Response("boom", { status: 500 });
      return sseResponse([{ event: "team.updated", data: { type: "team.updated" } }], false, req.signal);
    });
    const events: UserEvent[] = [];
    const statuses: SseStatus[] = [];
    const stop = createClient({ baseUrl: srv.url, heartbeatMs: 30 }).subscribeUser((e) => events.push(e), {
      onStatus: (s) => statuses.push(s),
    });
    await Bun.sleep(150);
    stop();
    expect(events).toEqual([{ type: "team.updated" }]);
    expect(statuses).toEqual(["connecting", "open"]);
    expect(beatsOf(srv).length).toBeGreaterThan(1);
  });

  test("un 403 en el SSE da status failed con DeviApiError y no reintenta", async () => {
    let sse = 0;
    const srv = serve((_req, url) => {
      if (url.pathname === "/api/v1/presence/heartbeat") return Response.json({ ok: true });
      sse++;
      return Response.json({ error: "no", code: "unknown_login", login: "x@y" }, { status: 403 });
    });
    const got: [SseStatus, unknown][] = [];
    const stop = createClient({ baseUrl: srv.url, heartbeatMs: 30 }).subscribeUser(() => {}, {
      onStatus: (s, err) => got.push([s, err]),
    });
    await Bun.sleep(200);
    stop();
    expect(sse).toBe(1);
    expect(got.map((g) => g[0])).toEqual(["connecting", "failed"]);
    const err = got[1]![1] as DeviApiError;
    expect(err).toBeInstanceOf(DeviApiError);
    expect(err.status).toBe(403);
    expect(err.body.code).toBe("unknown_login");
    // tras fallar no quedan heartbeats corriendo
    const n = beatsOf(srv).length;
    await Bun.sleep(100);
    expect(beatsOf(srv).length).toBe(n);
  });
});
