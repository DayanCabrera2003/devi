import type { UserEvent } from "@devi/protocol";
import { afterEach, describe, expect, test, vi } from "vitest";
import { REPLAY_QUIET_MS } from "./app.svelte";
import { HAPPY_MS, SLEEP_AFTER_MS } from "./mood";
import { fakeApp } from "./test-app";
import { req } from "./test-fixtures";

// Conecta, abre el canal y deja pasar el reenvío inicial: lo que se empuje después llega "en vivo".
async function live() {
  vi.useFakeTimers();
  let push: (e: UserEvent) => void = () => {};
  const subscribe = vi.fn((onEvent: (e: UserEvent) => void, onStatus: (s: string) => void) => {
    push = onEvent;
    onStatus("open");
    return () => {};
  });
  const t = await fakeApp({ subscribe });
  await vi.advanceTimersByTimeAsync(REPLAY_QUIET_MS * 10);
  return { ...t, push: (e: UserEvent) => push(e) };
}

const emitted = (app: { publishMascot(): void }, emitMascot: unknown) => {
  app.publishMascot();
  return (emitMascot as ReturnType<typeof vi.fn>).mock.lastCall?.[0];
};

// Respuesta de María (m2) a una solicitud mía (m1).
const answer = req({ id: "q7", fromMemberId: "m1", toMemberId: "m2", status: "answered", outcome: "answered", outcomeText: "hecho" });

describe("DeviApp: humor de Devi", () => {
  afterEach(() => vi.useRealTimers());

  test("en reposo al conectar y atenta con algo pendiente", async () => {
    const { app, push } = await live();
    expect(app.mood).toBe("calm");
    push({ type: "request.incoming", request: req({ deadline: Date.now() + 60_000 }) });
    expect(app.mood).toBe("attentive");
  });

  test("contenta un momento al llegar una respuesta", async () => {
    const { app, push } = await live();
    push({ type: "response.incoming", request: answer });
    expect(app.mood).toBe("happy");
    await vi.advanceTimersByTimeAsync(HAPPY_MS);
    expect(app.mood).toBe("attentive");
  });

  test("la mascota recibe el humor", async () => {
    const t = await live();
    t.push({ type: "response.incoming", request: answer });
    const deps = (t.app as unknown as { deps: { emitMascot: unknown } }).deps;
    expect(emitted(t.app, deps.emitMascot)).toMatchObject({ mood: "happy", pending: 1 });
  });

  test("inquieta si una solicitud mía caducó sin respuesta", async () => {
    const { app, push } = await live();
    push({ type: "request.timed_out", request: req({ id: "q8", fromMemberId: "m1", toMemberId: "m2", status: "timed_out" }) });
    expect(app.mood).toBe("uneasy");
  });

  test("se duerme tras un rato sin pendientes y se despierta con la actividad", async () => {
    const { app, push } = await live();
    app.clock.now = Date.now() + SLEEP_AFTER_MS;
    expect(app.mood).toBe("sleeping");
    push({ type: "request.incoming", request: req({ deadline: Date.now() + SLEEP_AFTER_MS * 2 }) });
    expect(app.mood).toBe("attentive");
  });

  test("gris sin conexión", async () => {
    const { app } = await fakeApp();
    expect(app.mood).toBe("offline");
  });
});
