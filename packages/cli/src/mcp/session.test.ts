import { expect, test } from "bun:test";
import { fakeClient } from "./fake-client";
import { startSessionLoop } from "./session";

const SESSION = (id: string) => ({ id, memberId: "m1", name: "api", cwd: "/p", status: "idle", lastSeen: 1 });
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
    onSession: (id) => ids.push(id),
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
