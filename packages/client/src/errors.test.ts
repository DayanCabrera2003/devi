import { expect, test } from "bun:test";
import { DeviApiError, describeApiError } from "./errors";

test("mensajes legibles por código", () => {
  expect(describeApiError(401, { error: "x", code: "no_identity" })).toContain("Tailscale está conectado");
  expect(describeApiError(403, { error: "x", code: "unknown_login", login: "ana@x" })).toBe(
    "Tu login de Tailscale (ana@x) no está en el equipo de Devi: pide al admin que te añada.",
  );
  expect(describeApiError(403, { error: "x", code: "missing_perm", perm: "team.admin" })).toBe(
    'Te falta el permiso "team.admin" (Administrar equipo) en Devi: pídeselo al admin.',
  );
  expect(describeApiError(403, { error: "x", code: "origin" })).toContain("rechazó el origen");
  expect(describeApiError(403, { error: "x", code: "human_only" })).toBe(
    "Esta acción solo se puede hacer desde la app de Devi: autorízala o respóndela tú en la app.",
  );
  expect(describeApiError(426, { error: "x", code: "version", minVersion: "2.0.0" })).toBe(
    "Esta versión de Devi no es compatible con el servidor (el servidor usa la 2.0.0): actualiza Devi.",
  );
  expect(describeApiError(409, { error: "La solicitud ya está respondida" })).toBe("La solicitud ya está respondida");
});

test("DeviApiError guarda status y cuerpo", () => {
  const e = new DeviApiError(403, { error: "x", code: "origin" });
  expect(e).toBeInstanceOf(Error);
  expect(e.name).toBe("DeviApiError");
  expect(e.status).toBe(403);
  expect(e.body).toEqual({ error: "x", code: "origin" });
  expect(e.message).toContain("origen");
});

test("dominio no permitido y límite de ritmo", () => {
  expect(describeApiError(403, { error: "x", code: "domain", login: "ana@gmail.com" })).toBe(
    "Tu login de Tailscale (ana@gmail.com) no es de un dominio permitido en este servidor de Devi. Entra en Tailscale con la cuenta del equipo o pide al admin que revise los dominios permitidos.",
  );
  expect(describeApiError(429, { error: "x", code: "rate_limit", retryAfter: 30 })).toBe(
    "Demasiadas acciones seguidas en Devi: espera 30 s y vuelve a intentarlo.",
  );
  expect(describeApiError(429, { error: "x", code: "rate_limit" })).toBe(
    "Demasiadas acciones seguidas en Devi: espera un momento y vuelve a intentarlo.",
  );
});
