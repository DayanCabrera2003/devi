import { afterEach, describe, expect, test } from "bun:test";
import { API_VERSION, type SessionDelivery, type UserEvent } from "@devi/protocol";
import { createClient } from "./client";
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
    const srv = serve((req) => {
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
});
