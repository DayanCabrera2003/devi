import { expect, test } from "bun:test";
import { DeviApiError } from "@devi/client";
import { fakeClient } from "./fake-client";
import { startSessionLoop } from "./session";

const SESSION = (id: string) => ({ id, memberId: "m1", name: "api", cwd: "/p", status: "idle" as const, lastSeen: 1, channel: false });
const tick = () => Bun.sleep(5);

test("registra, escucha y se vuelve a registrar si el stream se cae", async () => {
  let n = 0;
  const f = fakeClient({ registerSession: () => SESSION(`s${++n}`) });
  const ids: (string | null)[] = [];
  const delays: number[] = [];
  const delivered: string[] = [];
  const stop = startSessionLoop({
    client: f.client,
    register: { name: "api", cwd: "/p", parentPid: 42 },
    onSession: (s) => ids.push(s?.id ?? null),
    onDelivery: (d) => delivered.push(d.content),
    log: () => {},
    sleep: async (ms) => {
      delays.push(ms);
    },
  });
  await tick();
  expect(f.calls[0]).toEqual({ name: "registerSession", opts: { body: { name: "api", cwd: "/p", parentPid: 42 } } });
  expect(f.subscriptions[0]!.sessionId).toBe("s1");
  f.subscriptions[0]!.onDelivery({ kind: "debug", content: "hola", meta: {} });
  expect(delivered).toEqual(["hola"]);

  f.subscriptions[0]!.onStatus!("reconnecting");
  await tick();
  expect(f.subscriptions[0]!.closed).toBe(true);
  expect(f.subscriptions[1]!.sessionId).toBe("s2");
  expect(ids).toEqual(["s1", null, "s2"]);
  expect(delays).toEqual([1000]);
  stop();
  expect(f.subscriptions[1]!.closed).toBe(true);
});

test("si el registro falla, reintenta con espera exponencial", async () => {
  const f = fakeClient({ registerSession: new Error("caído") });
  const delays: number[] = [];
  let stop = () => {};
  stop = startSessionLoop({
    client: f.client,
    register: { name: "api", cwd: "/p", parentPid: 42 },
    onSession: () => {},
    onDelivery: () => {},
    log: () => {},
    sleep: async (ms) => {
      delays.push(ms);
      if (delays.length === 6) stop();
    },
  });
  await tick();
  expect(delays).toEqual([1000, 2000, 4000, 8000, 16_000, 30_000]);
});

test("un status failed se registra y el bucle se detiene sin reintentar", async () => {
  const f = fakeClient({ registerSession: () => SESSION("s1") });
  const ids: (string | null)[] = [];
  const logs: string[] = [];
  const delays: number[] = [];
  const stop = startSessionLoop({
    client: f.client,
    register: { name: "api", cwd: "/p", parentPid: 42 },
    onSession: (s) => ids.push(s?.id ?? null),
    onDelivery: () => {},
    log: (...a) => logs.push(a.join(" ")),
    sleep: async (ms) => {
      delays.push(ms);
    },
  });
  await tick();
  f.subscriptions[0]!.onStatus!("failed", new DeviApiError(403, { error: "no", code: "unknown_login", login: "x@y" }));
  await tick();
  expect(f.subscriptions.length).toBe(1);
  expect(f.subscriptions[0]!.closed).toBe(true);
  expect(ids).toEqual(["s1", null]);
  expect(delays).toEqual([]);
  expect(logs.some((l) => l.includes("Se deja de reintentar"))).toBe(true);
  stop();
});

test("pasa al servidor la identidad completa y entrega la sesión (con el nombre definitivo)", async () => {
  const f = fakeClient({ registerSession: () => ({ ...SESSION("s1"), name: "api (2)" }) });
  const got: unknown[] = [];
  const register = { name: "api", cwd: "/p", parentPid: 42, machine: "M1", instanceId: "i1", claudeSessionId: "cs", channel: true };
  const stop = startSessionLoop({ client: f.client, register, onSession: (s) => got.push(s?.name ?? null), onDelivery: () => {}, log: () => {} });
  await tick();
  expect(f.calls[0]).toEqual({ name: "registerSession", opts: { body: register } });
  expect(got).toEqual(["api (2)"]);
  stop();
});

test("si otro MCP del mismo Claude Code lo sustituyó (409 session_replaced), deja de intentarlo", async () => {
  const f = fakeClient({ registerSession: new DeviApiError(409, { error: "sustituida", code: "session_replaced" }) });
  const delays: number[] = [];
  const logs: string[] = [];
  const stop = startSessionLoop({
    client: f.client,
    register: { name: "api", cwd: "/p", parentPid: 42 },
    onSession: () => {},
    onDelivery: () => {},
    log: (...a) => logs.push(a.join(" ")),
    sleep: async (ms) => {
      delays.push(ms);
      // Si el bucle reintentara, este sleep instantáneo lo convertiría en un bucle
      // infinito que agota la memoria: se congela tras unos pocos reintentos.
      if (delays.length > 10) await new Promise(() => {});
    },
  });
  await tick();
  expect(f.calls.filter((c) => c.name === "registerSession")).toHaveLength(1);
  expect(delays).toEqual([]);
  expect(logs.some((l) => l.includes("sustitu"))).toBe(true);
  stop();
});
