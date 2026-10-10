import { describe, expect, test } from "bun:test";
import { DeviState, TransitionError } from "./state";

function setup() {
  const state = new DeviState(60_000);
  const dayanFront = state.addSession("dayan", "frontend");
  const mariaApi = state.addSession("maria", "backend-api");
  const req = state.createRequest(
    { from: "dayan", fromSessionId: dayanFront.id, to: "maria", message: "¿me apruebas el PR #12?" },
    1_000,
  );
  return { state, dayanFront, mariaApi, req };
}

const statusOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as TransitionError).status;
  }
  return 0;
};

describe("crear solicitud", () => {
  test("queda pendiente con la sesión de origen y el plazo", () => {
    const { req, dayanFront } = setup();
    expect(req.status).toBe("pending");
    expect(req.fromSessionId).toBe(dayanFront.id);
    expect(req.fromSessionName).toBe("frontend");
    expect(req.deadline).toBe(61_000);
  });

  test("rechaza sesión ajena, mensaje vacío o enviarse a uno mismo", () => {
    const { state, dayanFront, mariaApi } = setup();
    expect(statusOf(() => state.createRequest({ from: "dayan", fromSessionId: mariaApi.id, to: "maria", message: "x" }))).toBe(400);
    expect(statusOf(() => state.createRequest({ from: "dayan", fromSessionId: dayanFront.id, to: "maria", message: "  " }))).toBe(400);
    expect(statusOf(() => state.createRequest({ from: "dayan", fromSessionId: dayanFront.id, to: "dayan", message: "x" }))).toBe(400);
  });
});

describe("enviar a sesión", () => {
  test("pasa a forwarded con la sesión elegida", () => {
    const { state, req, mariaApi } = setup();
    const { session } = state.forward(req.id, mariaApi.id);
    expect(session.name).toBe("backend-api");
    expect(state.get(req.id).status).toBe("forwarded");
    expect(state.get(req.id).forwardedSessionId).toBe(mariaApi.id);
  });

  test("no se puede reenviar dos veces (409)", () => {
    const { state, req, mariaApi } = setup();
    state.forward(req.id, mariaApi.id);
    expect(statusOf(() => state.forward(req.id, mariaApi.id))).toBe(409);
  });

  test("no se puede enviar a una sesión cerrada o de otra persona (409)", () => {
    const { state, req, mariaApi, dayanFront } = setup();
    expect(statusOf(() => state.forward(req.id, dayanFront.id))).toBe(409);
    state.removeSession(mariaApi.id);
    expect(statusOf(() => state.forward(req.id, mariaApi.id))).toBe(409);
  });

  test("solicitud desconocida (404)", () => {
    const { state, mariaApi } = setup();
    expect(statusOf(() => state.forward("nope", mariaApi.id))).toBe(404);
  });
});

describe("aceptar y rechazar (B)", () => {
  test("aceptar con o sin nota", () => {
    const { state, req } = setup();
    const r = state.accept(req.id, "  lo hago en 10 min ");
    expect(r.status).toBe("accepted");
    expect(r.outcomeText).toBe("lo hago en 10 min");
    const other = setup();
    expect(other.state.accept(other.req.id).outcomeText).toBeUndefined();
  });

  test("rechazar sin motivo → 400, con motivo → rejected", () => {
    const { state, req } = setup();
    expect(statusOf(() => state.reject(req.id, "   "))).toBe(400);
    expect(state.get(req.id).status).toBe("pending");
    expect(state.reject(req.id, "no tengo permisos").outcomeText).toBe("no tengo permisos");
  });

  test("no se puede aceptar algo ya reenviado (409)", () => {
    const { state, req, mariaApi } = setup();
    state.forward(req.id, mariaApi.id);
    expect(statusOf(() => state.accept(req.id))).toBe(409);
  });
});

describe("responder desde la sesión (B)", () => {
  test("solo tras forward, solo el destinatario y no dos veces", () => {
    const { state, req, mariaApi } = setup();
    expect(statusOf(() => state.respond(req.id, "maria", "ok"))).toBe(409);
    state.forward(req.id, mariaApi.id);
    expect(statusOf(() => state.respond(req.id, "dayan", "ok"))).toBe(403);
    expect(statusOf(() => state.respond(req.id, "maria", " "))).toBe(400);
    const r = state.respond(req.id, "maria", "Lo reviso y lo apruebo si pasan los tests");
    expect(r.status).toBe("answered");
    expect(statusOf(() => state.respond(req.id, "maria", "otra vez"))).toBe(409);
  });
});

describe("respuesta en A", () => {
  test("aceptar la respuesta la cierra sin enviar nada", () => {
    const { state, req } = setup();
    state.accept(req.id);
    expect(state.closeResponse(req.id).status).toBe("closed");
    expect(state.get(req.id).outcome).toBe("accepted");
    expect(statusOf(() => state.closeResponse(req.id))).toBe(409);
  });

  test("enviar a sesión: solo sesiones de A que sigan abiertas", () => {
    const { state, req, mariaApi, dayanFront } = setup();
    state.reject(req.id, "no puedo");
    expect(statusOf(() => state.forwardResponse(req.id, mariaApi.id))).toBe(409);
    const { session } = state.forwardResponse(req.id, dayanFront.id);
    expect(session.name).toBe("frontend");
    expect(state.get(req.id).status).toBe("closed");
    expect(state.get(req.id).outcome).toBe("rejected");
  });

  test("no hay respuesta que cerrar mientras está pendiente", () => {
    const { state, req } = setup();
    expect(statusOf(() => state.closeResponse(req.id))).toBe(409);
  });
});

describe("timeout", () => {
  test("no vence antes del plazo; vence desde pending", () => {
    const { state, req } = setup();
    expect(state.timeout(req.id, 60_999)).toBeUndefined();
    expect(state.timeout(req.id, 61_000)?.status).toBe("timed_out");
  });

  test("vence también si la sesión de B no responde (forwarded)", () => {
    const { state, req, mariaApi } = setup();
    state.forward(req.id, mariaApi.id);
    expect(state.timeout(req.id, 61_000)?.status).toBe("timed_out");
  });

  test("no vence si ya hubo respuesta", () => {
    const { state, req } = setup();
    state.accept(req.id);
    expect(state.timeout(req.id, 99_999)).toBeUndefined();
    expect(state.get(req.id).status).toBe("accepted");
  });

  test("reenviar vuelve a pending con plazo nuevo; ignorar cierra", () => {
    const { state, req, mariaApi } = setup();
    state.forward(req.id, mariaApi.id);
    state.timeout(req.id, 61_000);
    const r = state.resend(req.id, 70_000);
    expect(r.status).toBe("pending");
    expect(r.deadline).toBe(130_000);
    expect(r.forwardedSessionId).toBeUndefined();
    expect(statusOf(() => state.ignore(req.id))).toBe(409);
    state.timeout(req.id, 130_000);
    expect(state.ignore(req.id).status).toBe("closed");
  });

  test("tarjetas abiertas por usuario", () => {
    const { state, req } = setup();
    expect(state.openCardsFor("maria").map((c) => c.type)).toEqual(["request"]);
    state.reject(req.id, "no");
    expect(state.openCardsFor("maria")).toEqual([]);
    expect(state.openCardsFor("dayan").map((c) => c.type)).toEqual(["response"]);
  });
});

describe("sesiones", () => {
  test("estado trabajando / libre por usuario y nombre", () => {
    const { state } = setup();
    expect(state.setStatus("maria", "backend-api", "working")?.status).toBe("working");
    expect(state.setStatus("maria", "no-existe", "working")).toBeUndefined();
  });
});
