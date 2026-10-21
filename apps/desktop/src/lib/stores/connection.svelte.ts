import { classifyError, isApiFailure } from "../api";

export type ConnState =
  | { status: "connecting" }
  | { status: "connected" }
  | { status: "reconnecting" }
  | { status: "unknown_login"; login: string }
  | { status: "update_required"; minVersion: string }
  | { status: "blocked"; message: string }; // 403 origin, missing_perm u otro 401/403: reintentar no sirve

const GENERIC_BLOCK = "El servidor de Devi cerró la conexión y no se volverá a intentar sola. Pulsa Reintentar.";

// Error al conectar (team.refresh) o "failed" del cliente. Solo los fallos de red y los 5xx
// reconectan solos; un 401/403/426 necesita que alguien haga algo.
export function fromError(e: unknown): ConnState {
  const k = classifyError(e);
  switch (k.kind) {
    case "unknown_login":
      return { status: "unknown_login", login: k.login };
    case "update_required":
      return { status: "update_required", minVersion: k.minVersion };
    case "origin":
    case "no_identity":
    case "missing_perm":
      return { status: "blocked", message: k.message };
    default:
      if (isApiFailure(e) && (e.status === 401 || e.status === 403)) return { status: "blocked", message: k.message };
      return { status: "reconnecting" };
  }
}

// Traduce onStatus de @devi/client ("connecting" | "open" | "reconnecting" | "failed").
// "failed" es terminal: el cliente ya no reintenta, así que nunca se muestra como "reconectando".
export function fromClient(status: string, err?: unknown): ConnState {
  if (status === "failed") {
    const s = err === undefined ? null : fromError(err);
    if (s && s.status !== "reconnecting") return s;
    return { status: "blocked", message: err === undefined ? GENERIC_BLOCK : classifyError(err).message || GENERIC_BLOCK };
  }
  if (status === "open" || status === "connected") return { status: "connected" };
  if (status === "connecting") return { status: "connecting" };
  return { status: "reconnecting" };
}

export function statusLabel(s: ConnState): string {
  switch (s.status) {
    case "connecting":
      return "conectando…";
    case "connected":
      return "conectado";
    case "reconnecting":
      return "sin conexión con el servidor, reconectando…";
    case "unknown_login":
      return "login no reconocido";
    case "update_required":
      return "hay que actualizar Devi";
    case "blocked":
      return "conexión rechazada";
  }
}

export class ConnectionStore {
  state = $state<ConnState>({ status: "connecting" });
  online = $derived(this.state.status === "connected");
  blocked = $derived(
    this.state.status === "unknown_login" || this.state.status === "update_required" || this.state.status === "blocked",
  );
  label = $derived(statusLabel(this.state));

  set(s: ConnState) {
    this.state = s;
  }
  fromClient(status: string, err?: unknown) {
    this.state = fromClient(status, err);
  }
  fail(e: unknown) {
    this.state = fromError(e);
  }
}
