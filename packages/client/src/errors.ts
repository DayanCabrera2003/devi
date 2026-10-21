import { PERM_LABELS, type ErrorBody, type Perm } from "@devi/protocol";

// Error de una llamada a la API. status 0 = no se pudo conectar con el servidor.
// `message` es un texto en español pensado para la persona; `body` es el cuerpo tal cual llegó.
export class DeviApiError extends Error {
  status: number;
  body: ErrorBody;

  constructor(status: number, body: ErrorBody) {
    super(describeApiError(status, body));
    this.name = "DeviApiError";
    this.status = status;
    this.body = body;
  }
}

export function describeApiError(status: number, body: ErrorBody): string {
  if (status === 401) {
    return "El servidor de Devi no pudo identificarte. Comprueba que Tailscale está conectado y que usas la URL https://<equipo>.<tailnet>.ts.net del servidor (no 127.0.0.1).";
  }
  if (status === 403 && body.code === "unknown_login") {
    return `Tu login de Tailscale (${body.login ?? "desconocido"}) no está en el equipo de Devi: pide al admin que te añada.`;
  }
  if (status === 403 && body.code === "domain") {
    return `Tu login de Tailscale (${body.login ?? "desconocido"}) no es de un dominio permitido en este servidor de Devi. Entra en Tailscale con la cuenta del equipo o pide al admin que revise los dominios permitidos.`;
  }
  if (status === 429 && body.code === "rate_limit") {
    const wait = body.retryAfter ? `${body.retryAfter} s` : "un momento";
    return `Demasiadas acciones seguidas en Devi: espera ${wait} y vuelve a intentarlo.`;
  }
  if (status === 403 && body.code === "missing_perm") {
    const label = body.perm && body.perm in PERM_LABELS ? ` (${PERM_LABELS[body.perm as Perm]})` : "";
    return `Te falta el permiso "${body.perm ?? "?"}"${label} en Devi: pídeselo al admin.`;
  }
  if (status === 403 && body.code === "origin") {
    return "El servidor de Devi rechazó el origen de la petición. Usa la app de escritorio de Devi o la CLI `devi`.";
  }
  if (status === 403 && body.code === "human_only") {
    return "Esta acción solo se puede hacer desde la app de Devi: autorízala o respóndela tú en la app.";
  }
  if (status === 426) {
    const min = body.minVersion ? ` (el servidor usa la ${body.minVersion})` : "";
    return `Esta versión de Devi no es compatible con el servidor${min}: actualiza Devi.`;
  }
  return body.error;
}
