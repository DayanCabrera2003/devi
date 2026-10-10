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

describe("sesiones", () => {
  test("estado trabajando / libre por usuario y nombre", () => {
    const { state } = setup();
    expect(state.setStatus("maria", "backend-api", "working")?.status).toBe("working");
    expect(state.setStatus("maria", "no-existe", "working")).toBeUndefined();
  });
});
