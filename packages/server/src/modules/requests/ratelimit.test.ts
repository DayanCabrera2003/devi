import { afterEach, describe, expect, test } from "bun:test";
import { setupFlow, type Flow } from "./fixture";

let f: Flow;
afterEach(() => f.cleanup());

describe("límites de ritmo por persona", () => {
  test("borradores: 20 cada 10 min; el 21 → 429 con Retry-After y mensaje en español", async () => {
    f = await setupFlow();
    for (let i = 0; i < 20; i++) expect((await f.requestDraft(`m${i}`)).status).toBe(200);
    const res = await f.requestDraft("uno más");
    expect(res.status).toBe(429);
    expect(res.data.code).toBe("rate_limit");
    expect(res.data.error).toContain("espera");
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
    // Otra persona no se ve afectada.
    expect((await f.createDraft("maria@dev", { kind: "request", sessionId: f.mariaApi.id, to: "m-dayan", message: "hola" })).status).toBe(200);
    f.clock.advance(60_000); // 20 por 10 min = 1 ficha cada 30 s
    expect((await f.requestDraft("ya puedo")).status).toBe(200);
  });

  test("borradores con archivos: 5 cada 10 min", async () => {
    f = await setupFlow();
    const file = () => [new File(["x"], "a.txt")];
    for (let i = 0; i < 5; i++) expect((await f.requestDraft(`m${i}`, file())).status).toBe(200);
    expect((await f.requestDraft("otro", file())).status).toBe(429);
    expect((await f.requestDraft("sin archivos")).status).toBe(200);
  });

  test("el resto de mutaciones: 120 por minuto; el latido no cuenta", async () => {
    f = await setupFlow();
    for (let i = 0; i < 150; i++) expect((await f.call("leo@dev", "POST", "/api/v1/presence/heartbeat", {})).status).toBe(200);
    // setupFlow ya gastó una (POST /sessions al registrar la sesión de Leo).
    for (let i = 0; i < 119; i++) expect((await f.call("leo@dev", "POST", "/api/v1/sessions/inbox/ack", { ids: [] })).status).toBe(200);
    const res = await f.call("leo@dev", "POST", "/api/v1/sessions/inbox/ack", { ids: [] });
    expect(res.status).toBe(429);
    expect((await f.call("leo@dev", "GET", "/api/v1/members/m-maria/sessions")).status).toBe(200); // las lecturas no cuentan
    expect((await f.call("leo@dev", "POST", "/api/v1/presence/heartbeat", {})).status).toBe(200);
  });

  test("los límites se configuran al crear la app", async () => {
    f = await setupFlow({ rateLimits: { draft: { max: 1, windowMs: 60_000 } } });
    expect((await f.requestDraft("uno")).status).toBe(200);
    expect((await f.requestDraft("dos")).status).toBe(429);
  });
});
