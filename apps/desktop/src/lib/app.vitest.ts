import type { DeviRequest, UserEvent } from "@devi/protocol";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { DeviApi } from "./api";
import { DeviApp, REPLAY_QUIET_MS } from "./app.svelte";
import type { ClientConfig, Native } from "./native";
import { ME, TEAM, draft, req } from "./test-fixtures";

const CONFIG: ClientConfig = { serverUrl: "https://pc.t.ts.net", app: { notifications: true, setupDone: true } };

function setup(config: ClientConfig | null = CONFIG, extra: { trayAttention?: (pending: number) => void } = {}) {
  let onEvent: (e: UserEvent) => void = () => {};
  let onStatus: (s: string, err?: unknown) => void = () => {};
  const live = { subs: 0, unsubscribes: 0 };
  const api = {
    me: vi.fn(async () => ME),
    team: vi.fn(async () => TEAM),
    memberSessions: vi.fn(async () => []),
    rejectRequest: vi.fn(async () => req({ status: "rejected", outcome: "rejected", outcomeText: "no" })),
    authorizeDraft: vi.fn(async () => draft({ status: "authorized" })),
    discardDraft: vi.fn(async () => draft({ status: "discarded" })),
    forwardRequest: vi.fn(async () => req({ status: "forwarded", forwardedSessionId: "s1" })),
    acceptResponse: vi.fn(async () => mine({ status: "closed", outcome: "answered" })),
    resendRequest: vi.fn(async () => mine({ status: "pending", sentAt: 9_000 })),
    ignoreRequest: vi.fn(async () => mine({ status: "closed" })),
    subscribe: vi.fn((ev: (e: UserEvent) => void, st: (s: string, err?: unknown) => void) => {
      onEvent = ev;
      onStatus = st;
      live.subs++;
      let done = false;
      return () => {
        if (done) return;
        done = true;
        live.subs--;
        live.unsubscribes++;
      };
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
    ...extra,
  });
  return {
    app, api, native, notify, emitMascot,
    event: (e: UserEvent) => onEvent(e),
    status: (s: string, err?: unknown) => onStatus(s, err),
    get liveSubs() {
      return live.subs;
    },
    get unsubscribes() {
      return live.unsubscribes;
    },
  };
}

// Deja pasar la ventana del reenvío inicial (requiere vi.useFakeTimers()).
const settle = () => vi.advanceTimersByTimeAsync(REPLAY_QUIET_MS * 10);

// Solicitud que hice yo (m1) a María (m2).
const mine = (over: Partial<DeviRequest> = {}) => req({ id: "q7", fromMemberId: "m1", toMemberId: "m2", ...over });

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
    vi.useFakeTimers();
    const t = setup();
    await t.app.boot();
    t.status("open");
    await settle();
    t.event(incoming); // en vivo, tras el reenvío inicial
    expect(t.app.inbox.cards).toHaveLength(1);
    expect(t.notify).toHaveBeenCalledOnce();
    expect(t.notify.mock.calls[0]?.[0]).toMatchObject({ title: "Devi · María te pide algo" });
    expect(t.app.pokeKey).toBe(1);

    t.status("reconnecting");
    expect(t.app.conn.state.status).toBe("reconnecting");
    t.status("open");
    expect(t.app.inbox.cards).toHaveLength(0); // el servidor reenvía las abiertas
    t.event(incoming);
    await settle();
    expect(t.app.inbox.cards).toHaveLength(1);
    expect(t.notify).toHaveBeenCalledOnce();
    expect(t.app.pokeKey).toBe(1); // una tarjeta ya avisada no hace rebotar a la mascota
  });

  test("un evento repetido en vivo no vuelve a rebotar a la mascota", async () => {
    vi.useFakeTimers();
    const t = setup();
    await t.app.boot();
    t.status("open");
    await settle();
    t.event(incoming);
    t.app.inbox.clear();
    t.event(incoming); // misma tarjeta (mismo sentAt): ya avisada
    expect(t.app.pokeKey).toBe(1);
  });

  test("con avisos en pausa no notifica", async () => {
    vi.useFakeTimers();
    const t = setup();
    await t.app.boot();
    t.status("open");
    await settle();
    t.app.setPaused(true);
    t.event(incoming);
    expect(t.app.inbox.cards).toHaveLength(1);
    expect(t.notify).not.toHaveBeenCalled();
  });

  test("el reenvío inicial tras open da un solo aviso resumen; lo que llega después avisa uno a uno", async () => {
    vi.useFakeTimers();
    const t = setup();
    await t.app.boot();
    t.status("open");
    t.event({ type: "draft.awaiting", draft: draft() });
    t.event(incoming);
    t.event({ type: "request.timed_out", request: req({ id: "q2", fromMemberId: "m1", toMemberId: "m2", status: "timed_out" }) });
    expect(t.notify).not.toHaveBeenCalled();
    await settle();
    expect(t.notify).toHaveBeenCalledOnce();
    expect(t.notify.mock.calls[0]?.[0]).toMatchObject({ body: "Tienes 3 avisos pendientes en Devi" });
    expect(t.app.pokeKey).toBe(1);

    t.event({ type: "request.incoming", request: req({ id: "q3", message: "¿Y esto?" }) });
    expect(t.notify).toHaveBeenCalledTimes(2);
    expect(t.notify.mock.calls[1]?.[0]).toMatchObject({ title: "Devi · María te pide algo", body: "¿Y esto?" });

    // Al reconectar, las ya avisadas no vuelven a avisar.
    t.status("reconnecting");
    t.status("open");
    t.event(incoming);
    t.event({ type: "draft.awaiting", draft: draft() });
    await settle();
    expect(t.notify).toHaveBeenCalledTimes(2);
  });

  test("con un solo aviso pendiente al abrir se muestra ese aviso", async () => {
    vi.useFakeTimers();
    const t = setup();
    await t.app.boot();
    t.status("open");
    t.event(incoming);
    await settle();
    expect(t.notify).toHaveBeenCalledOnce();
    expect(t.notify.mock.calls[0]?.[0]).toMatchObject({ title: "Devi · María te pide algo" });
  });

  test("el resumen del reenvío respeta pausar avisos", async () => {
    vi.useFakeTimers();
    const t = setup();
    await t.app.boot();
    t.app.setPaused(true);
    t.status("open");
    t.event(incoming);
    t.event({ type: "draft.awaiting", draft: draft() });
    await settle();
    expect(t.notify).not.toHaveBeenCalled();
    t.app.setPaused(false);
    t.status("reconnecting");
    t.status("open");
    t.event(incoming);
    await settle();
    expect(t.notify).not.toHaveBeenCalled(); // ya se contaron como avisadas
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

  test("failed + missing_perm: bloqueada (nunca reconectando) y se cancela la suscripción", async () => {
    const t = setup();
    await t.app.boot();
    t.status("open");
    t.status("failed", { status: 403, body: { error: "x", code: "missing_perm", perm: "requests.send" } });
    expect(t.app.conn.state.status).toBe("blocked");
    expect(t.app.conn.label).not.toContain("reconectando");
    expect(t.unsubscribes).toBe(1);
  });

  test("failed + 401: bloqueada", async () => {
    const t = setup();
    await t.app.boot();
    t.status("failed", { status: 401, body: { error: "x", code: "no_identity" } });
    expect(t.app.conn.state.status).toBe("blocked");
  });

  test("connect() con 403 missing_perm: bloqueada, sin reintentos ni suscripción", async () => {
    vi.useFakeTimers();
    const t = setup();
    t.api.me.mockRejectedValue({ status: 403, body: { error: "x", code: "missing_perm", perm: "requests.send" } });
    await t.app.boot();
    expect(t.app.conn.state.status).toBe("blocked");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.api.me).toHaveBeenCalledOnce();
    expect(t.api.subscribe).not.toHaveBeenCalled();
  });

  test("dos connect() solapados acaban con una sola suscripción viva", async () => {
    const t = setup();
    const gates: Array<() => void> = [];
    t.api.me.mockImplementation(() => new Promise((ok) => gates.push(() => ok(ME))));
    t.app.config = CONFIG;
    const first = t.app.connect();
    const second = t.app.connect();
    // Se resuelven en orden inverso: el connect viejo llega tarde.
    while (gates.length < 2) await Promise.resolve();
    for (const g of [...gates].reverse()) g();
    await Promise.all([first, second]);
    expect(t.liveSubs).toBe(1);
    expect(t.api.subscribe).toHaveBeenCalledOnce();
    t.app.disconnect();
    expect(t.liveSubs).toBe(0);
  });

  test("disconnect() durante connect(): no queda ninguna suscripción", async () => {
    const t = setup();
    await t.app.boot();
    t.app.disconnect();
    let release: () => void = () => {};
    t.api.me.mockImplementation(() => new Promise((ok) => (release = () => ok(ME))));
    const p = t.app.connect();
    t.app.disconnect();
    release();
    await p;
    expect(t.liveSubs).toBe(0);
  });

  test("un connect() viejo que falla no pisa el estado del nuevo ni programa reintentos", async () => {
    vi.useFakeTimers();
    const t = setup();
    await t.app.boot();
    let failOld: () => void = () => {};
    t.api.me.mockImplementationOnce(() => new Promise((_, ko) => (failOld = () => ko(new TypeError("Failed to fetch")))));
    const old = t.app.connect();
    await t.app.connect();
    t.status("open");
    failOld();
    await old;
    expect(t.app.conn.state.status).toBe("connected");
    const calls = t.api.me.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.api.me.mock.calls.length).toBe(calls);
    expect(t.liveSubs).toBe(1);
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

  test("volver a ejecutar el asistente se puede cancelar mientras la config siga completa", async () => {
    const t = setup();
    await t.app.boot();
    t.app.restartWizard();
    expect(t.app.phase).toBe("wizard");
    expect(t.app.canCancelWizard).toBe(true);
    await t.app.cancelWizard();
    expect(t.app.phase).toBe("app");
    expect(t.api.subscribe).toHaveBeenCalledTimes(2);
  });

  test("el primer arranque no se puede cancelar", async () => {
    const t = setup(null);
    await t.app.boot();
    expect(t.app.canCancelWizard).toBe(false);
    await t.app.cancelWizard();
    expect(t.app.phase).toBe("wizard");
  });

  describe("contrato con el cliente y tarjetas", () => {
    const mixed: UserEvent[] = [
      { type: "draft.awaiting", draft: draft() },
      incoming,
      { type: "response.incoming", request: mine({ status: "answered", outcome: "answered", outcomeText: "Hecho" }) },
      { type: "request.timed_out", request: req({ id: "q8", fromMemberId: "m1", toMemberId: "m2", status: "timed_out" }) },
    ];

    test("open llega antes que los frames reenviados: lo reenviado se queda en la bandeja", async () => {
      vi.useFakeTimers();
      const t = setup();
      await t.app.boot();
      t.status("open");
      for (const ev of mixed) t.event(ev);
      await settle();
      expect(t.app.inbox.cards.map((c) => c.kind)).toEqual(["draft", "request", "response", "timeout"]);
      expect(t.emitMascot).toHaveBeenLastCalledWith(expect.objectContaining({ online: true, pending: 4 }));
    });

    test("al reconectar se vacía la bandeja y se rehace con el reenvío (tipos mezclados)", async () => {
      vi.useFakeTimers();
      const t = setup();
      await t.app.boot();
      t.status("open");
      for (const ev of mixed) t.event(ev);
      await settle();
      expect(t.notify).toHaveBeenCalledOnce(); // resumen
      t.status("reconnecting");
      expect(t.app.inbox.cards).toHaveLength(4); // mientras reconecta se ven las de antes
      t.status("open");
      expect(t.app.inbox.cards).toHaveLength(0);
      // Entretanto se respondió la solicitud entrante y se autorizó el borrador: el servidor no las reenvía.
      t.event(mixed[2]!);
      t.event(mixed[3]!);
      await settle();
      expect(t.app.inbox.cards.map((c) => c.key)).toEqual(["response:q7", "timeout:q8"]);
      expect(t.notify).toHaveBeenCalledOnce();
    });

    test("cada acción quita su tarjeta", async () => {
      vi.useFakeTimers();
      const t = setup();
      await t.app.boot();
      t.status("open");
      await settle();
      const fill = () => {
        t.app.inbox.clear();
        for (const ev of mixed) t.event(ev);
        t.event({ type: "request.timed_out", request: mine({ id: "q9", status: "timed_out" }) });
      };
      const keys = () => t.app.inbox.cards.map((c) => c.key);

      fill();
      await t.app.authorizeDraft(draft());
      expect(keys()).not.toContain("draft:d1");

      fill();
      await t.app.discardDraft(draft());
      expect(keys()).not.toContain("draft:d1");

      fill();
      await t.app.forward(req(), "s1");
      expect(t.api.forwardRequest).toHaveBeenCalledWith("q1", "s1");
      expect(keys()).not.toContain("request:q1");

      fill();
      await t.app.acceptResponse(mine());
      expect(keys()).not.toContain("response:q7");

      fill();
      t.api.resendRequest.mockResolvedValueOnce(req({ id: "q8", fromMemberId: "m1", toMemberId: "m2", status: "pending", sentAt: 9_000 }));
      await t.app.resend(req({ id: "q8" }));
      expect(keys()).not.toContain("timeout:q8");

      fill();
      t.api.ignoreRequest.mockResolvedValueOnce(mine({ id: "q9", status: "closed" }));
      await t.app.ignore(mine({ id: "q9" }));
      expect(keys()).not.toContain("timeout:q9");
      expect(keys()).toHaveLength(4); // el resto sigue ahí
      expect(t.emitMascot).toHaveBeenLastCalledWith(expect.objectContaining({ pending: 4 }));
    });
  });

  describe("alertas de seguridad (audit.alert)", () => {
    const entry = {
      id: 1, at: 1, actorMemberId: "m1", actorLogin: "dayan@x", action: "member.updated", targetType: "member", targetId: "m2", details: {},
    };
    const alert = (e: unknown = entry) => ({ type: "audit.alert", entry: e }) as unknown as UserEvent;

    test("admin: aviso nativo una sola vez por entrada y contador para la pestaña", async () => {
      const t = setup();
      await t.app.boot();
      t.status("open");
      t.event(alert());
      t.event(alert());
      expect(t.notify).toHaveBeenCalledOnce();
      expect(t.notify).toHaveBeenCalledWith(expect.objectContaining({ title: "Devi · Cambio de seguridad: Persona modificada" }));
      expect(t.app.auditAlerts.map((e) => e.id)).toEqual([1]);
      expect(t.app.inbox.cards).toHaveLength(0);
      t.app.clearAuditAlerts();
      expect(t.app.auditAlerts).toEqual([]);
    });

    test("sin avisos activados: no notifica, pero sí cuenta", async () => {
      const t = setup({ ...CONFIG, app: { notifications: false, setupDone: true } });
      await t.app.boot();
      t.event(alert());
      expect(t.notify).not.toHaveBeenCalled();
      expect(t.app.auditAlerts).toHaveLength(1);
    });

    test("quien no es admin no recibe nada", async () => {
      const t = setup();
      t.api.me.mockResolvedValue({ ...ME, perms: ["requests.send"] });
      await t.app.boot();
      t.event(alert());
      expect(t.notify).not.toHaveBeenCalled();
      expect(t.app.auditAlerts).toHaveLength(0);
    });

    // Los audit.alert mal formados ya los descarta @devi/client al validar con UserEventSchema.
    test("un evento desconocido se ignora sin romper nada", async () => {
      const t = setup();
      await t.app.boot();
      expect(() => t.event({ type: "algo.nuevo", x: 1 } as unknown as UserEvent)).not.toThrow();
      expect(t.notify).not.toHaveBeenCalled();
      expect(t.app.auditAlerts).toHaveLength(0);
      expect(t.app.inbox.cards).toHaveLength(0);
    });
  });

  test("el icono de la bandeja sigue lo que me espera, sin repetir el mismo número", async () => {
    vi.useFakeTimers();
    const trayAttention = vi.fn();
    const t = setup(CONFIG, { trayAttention });
    await t.app.boot();
    t.status("open");
    await settle();
    expect(trayAttention).toHaveBeenLastCalledWith(0);
    const calls = trayAttention.mock.calls.length;
    t.event(incoming);
    expect(trayAttention).toHaveBeenLastCalledWith(1);
    t.event({ type: "draft.awaiting", draft: draft() });
    expect(trayAttention).toHaveBeenLastCalledWith(2);
    t.app.publishMascot(); // mismo número: no se vuelve a llamar a Rust
    expect(trayAttention).toHaveBeenCalledTimes(calls + 2);
    await t.app.discardDraft(draft());
    expect(trayAttention).toHaveBeenLastCalledWith(1);
  });
});
