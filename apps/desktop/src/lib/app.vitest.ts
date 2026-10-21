import type { UserEvent } from "@devi/protocol";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { DeviApi } from "./api";
import { DeviApp } from "./app.svelte";
import type { ClientConfig, Native } from "./native";
import { ME, TEAM, req } from "./test-fixtures";

const CONFIG: ClientConfig = { serverUrl: "https://pc.t.ts.net", app: { notifications: true, setupDone: true } };

function setup(config: ClientConfig | null = CONFIG) {
  let onEvent: (e: UserEvent) => void = () => {};
  let onStatus: (s: string, err?: unknown) => void = () => {};
  const api = {
    me: vi.fn(async () => ME),
    team: vi.fn(async () => TEAM),
    memberSessions: vi.fn(async () => []),
    rejectRequest: vi.fn(async () => req({ status: "rejected", outcome: "rejected", outcomeText: "no" })),
    subscribe: vi.fn((ev: (e: UserEvent) => void, st: (s: string, err?: unknown) => void) => {
      onEvent = ev;
      onStatus = st;
      return () => {};
    }),
  };
  const native = {
    readConfig: vi.fn(async () => config),
    writeConfig: vi.fn(async () => {}),
    startServer: vi.fn(async () => ({ running: true, pid: 7, exitCode: null, log: [] })),
    setPaused: vi.fn(async () => {}),
  };
  const notify = vi.fn();
  const emitMascot = vi.fn();
  const app = new DeviApp({
    native: native as unknown as Native,
    makeApi: () => api as unknown as DeviApi,
    notify,
    emitMascot,
  });
  return {
    app, api, native, notify, emitMascot,
    event: (e: UserEvent) => onEvent(e),
    status: (s: string, err?: unknown) => onStatus(s, err),
  };
}

const incoming: UserEvent = { type: "request.incoming", request: req() };

describe("DeviApp", () => {
  afterEach(() => vi.useRealTimers());

  test("sin configuración abre el asistente", async () => {
    const t = setup(null);
    await t.app.boot();
    expect(t.app.phase).toBe("wizard");
    expect(t.api.me).not.toHaveBeenCalled();
  });

  test("con configuración conecta y se suscribe", async () => {
    const t = setup();
    await t.app.boot();
    expect(t.app.phase).toBe("app");
    expect(t.api.subscribe).toHaveBeenCalledOnce();
    t.status("open");
    expect(t.app.conn.online).toBe(true);
    expect(t.emitMascot).toHaveBeenLastCalledWith(expect.objectContaining({ online: true, pending: 0 }));
  });

  test("una solicitud entrante avisa una sola vez, también tras reconectar", async () => {
    const t = setup();
    await t.app.boot();
    t.status("open");
    t.event(incoming);
    expect(t.app.inbox.cards).toHaveLength(1);
    expect(t.notify).toHaveBeenCalledOnce();
    expect(t.notify.mock.calls[0]?.[0]).toMatchObject({ title: "Devi · María te pide algo" });

    t.status("reconnecting");
    expect(t.app.conn.state.status).toBe("reconnecting");
    t.status("open");
    expect(t.app.inbox.cards).toHaveLength(0); // el servidor reenvía las abiertas
    t.event(incoming);
    expect(t.app.inbox.cards).toHaveLength(1);
    expect(t.notify).toHaveBeenCalledOnce();
    expect(t.app.pokeKey).toBe(2);
  });

  test("con avisos en pausa no notifica", async () => {
    const t = setup();
    await t.app.boot();
    t.status("open");
    t.app.setPaused(true);
    t.event(incoming);
    expect(t.app.inbox.cards).toHaveLength(1);
    expect(t.notify).not.toHaveBeenCalled();
  });

  test("login desconocido: pantalla propia y sin suscripción", async () => {
    const t = setup();
    t.api.me.mockRejectedValue({ status: 403, body: { error: "x", code: "unknown_login", login: "dayan@x" } });
    await t.app.boot();
    expect(t.app.conn.state).toEqual({ status: "unknown_login", login: "dayan@x" });
    expect(t.api.subscribe).not.toHaveBeenCalled();
  });

  test("origen rechazado: conexión bloqueada", async () => {
    const t = setup();
    t.api.me.mockRejectedValue({ status: 403, body: { error: "x", code: "origin" } });
    await t.app.boot();
    expect(t.app.conn.state.status).toBe("blocked");
  });

  test("sin red reintenta con espera", async () => {
    vi.useFakeTimers();
    const t = setup();
    t.api.me.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await t.app.boot();
    expect(t.app.conn.state.status).toBe("reconnecting");
    expect(t.api.subscribe).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.api.subscribe).toHaveBeenCalledOnce();
  });

  test("rechazar quita la tarjeta con la solicitud que devuelve el servidor", async () => {
    const t = setup();
    await t.app.boot();
    t.status("open");
    t.event(incoming);
    await t.app.reject(req(), "no");
    expect(t.api.rejectRequest).toHaveBeenCalledWith("q1", "no");
    expect(t.app.inbox.cards).toHaveLength(0);
  });

  test("modo servidor: arranca el sidecar con el login admin", async () => {
    const t = setup({ ...CONFIG, app: { notifications: true, setupDone: true, serverAdminLogin: "dayan@x" } });
    await t.app.boot();
    expect(t.native.startServer).toHaveBeenCalledWith("dayan@x");
    expect(t.app.server?.running).toBe(true);
  });

  test("si el puerto 4747 está ocupado, el error queda visible", async () => {
    const t = setup({ ...CONFIG, app: { notifications: true, setupDone: true, serverAdminLogin: "dayan@x" } });
    t.native.startServer.mockRejectedValue("Ya hay un servidor de Devi en el puerto 4747 (¿quedó abierto de antes?)");
    await t.app.boot();
    expect(t.app.serverError).toContain("puerto 4747");
    expect(t.app.server?.running).toBe(false);
  });

  test("el asistente guarda la config al conectar y setupDone solo al final", async () => {
    const t = setup(null);
    await t.app.boot();
    await t.app.saveWizardConfig({ serverUrl: "http://127.0.0.1:4747", devUser: "dayan@dev" });
    expect(t.native.writeConfig).toHaveBeenLastCalledWith(
      expect.objectContaining({
        serverUrl: "http://127.0.0.1:4747",
        devUser: "dayan@dev",
        app: expect.objectContaining({ setupDone: false }),
      }),
    );
    expect(t.app.phase).toBe("wizard");
    await t.app.finishWizard();
    expect(t.native.writeConfig).toHaveBeenLastCalledWith(
      expect.objectContaining({ devUser: "dayan@dev", app: expect.objectContaining({ setupDone: true }) }),
    );
    expect(t.app.phase).toBe("app");
    expect(t.api.subscribe).toHaveBeenCalledOnce();
  });
});
