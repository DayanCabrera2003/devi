import { afterEach, expect, test } from "bun:test";
import { createClient } from "@devi/client";
import { CLAIM_REDEEM_BUDGET_MS, CLAIM_UNREACHABLE_MESSAGE, claimFailureNote, redeemWithRetry } from "./claim";

let servers: { stop: (f?: boolean) => void }[] = [];
afterEach(() => {
  for (const s of servers) s.stop(true);
  servers = [];
});
function serveRaw(handler: (req: Request) => Response | Promise<Response>) {
  const s = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: handler });
  servers.push(s);
  return s;
}
function serve(handler: (req: Request) => Response | Promise<Response>) {
  const s = serveRaw(handler);
  return createClient({ baseUrl: `http://127.0.0.1:${s.port}`, devUser: "maria@dev" });
}
const pair = { claudeSessionId: "c1", parentPid: 10, machine: "M1" };
const DELIVERY = { kind: "request" as const, content: "hola", meta: { request_id: "r1", inbox_id: "ib1" } };

test("reintenta mientras la sesión no está conectada y acaba entregando", async () => {
  let calls = 0;
  const client = serve(() =>
    ++calls < 3 ? Response.json({ error: "aún no", code: "session_unknown" }, { status: 409 }) : Response.json({ delivery: DELIVERY }),
  );
  const r = await redeemWithRetry(client, "K7Q4MX", pair, { intervalMs: 20, budgetMs: 1000 });
  expect(r).toEqual({ ok: true, delivery: DELIVERY });
  expect(calls).toBe(3);
});

test("otros errores no se reintentan", async () => {
  let calls = 0;
  const client = serve(() => {
    calls++;
    return Response.json({ error: "Ese código caducó: genera otro en la app de Devi", code: "claim_expired" }, { status: 410 });
  });
  const r = await redeemWithRetry(client, "K7Q4MX", pair, { intervalMs: 20, budgetMs: 1000 });
  expect(r).toEqual({ ok: false, message: "Ese código caducó: genera otro en la app de Devi" });
  expect(calls).toBe(1);
});

test("sin sesión hasta agotar el plazo: falla con el mensaje del servidor", async () => {
  const client = serve(() => Response.json({ error: "Esta sesión aún no está conectada a Devi", code: "session_unknown" }, { status: 409 }));
  const r = await redeemWithRetry(client, "K7Q4MX", pair, { intervalMs: 20, budgetMs: 100 });
  expect(r).toEqual({ ok: false, message: "Esta sesión aún no está conectada a Devi" });
});

test("si el servidor no contesta, el motivo es propio y no manda generar otro código", async () => {
  const client = createClient({
    baseUrl: `http://127.0.0.1:${serveRaw(() => new Promise<Response>(() => {})).port}`,
    devUser: "maria@dev",
    fetch: ((url: string, init?: RequestInit) => fetch(url, { ...init, signal: AbortSignal.timeout(100) })) as typeof fetch,
  });
  const r = await redeemWithRetry(client, "K7Q4MX", pair, { intervalMs: 20, budgetMs: 50 });
  expect(r).toEqual({ ok: false, message: CLAIM_UNREACHABLE_MESSAGE, unreachable: true });
  const note = claimFailureNote("K7Q4MX", r.ok ? "" : r.message, { unreachable: true });
  expect(note).toContain("puede que la entrega ya esté en esta sesión");
  expect(note).not.toContain("genere otro");
});

test("la nota de error dice qué pasó y qué hacer, sin texto de compañeros", () => {
  const note = claimFailureNote("K7Q4MX", "Ese código caducó: genera otro en la app de Devi");
  expect(note).toContain("K7Q-4MX");
  expect(note).toContain("Ese código caducó");
  expect(note).toContain("Díselo al usuario");
  expect(note).toContain("genere otro");
  expect(CLAIM_REDEEM_BUDGET_MS).toBe(2000);
});
