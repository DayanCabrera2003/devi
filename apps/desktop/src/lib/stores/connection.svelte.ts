import { classifyError } from "../api";

export type ConnState =
  | { status: "connecting" }
  | { status: "connected" }
  | { status: "reconnecting" }
  | { status: "unknown_login"; login: string }
  | { status: "update_required"; minVersion: string }
  | { status: "blocked"; message: string }; // 403 origin, 401 sin identidad

export function fromError(e: unknown): ConnState {
  const k = classifyError(e);
  switch (k.kind) {
    case "unknown_login":
      return { status: "unknown_login", login: k.login };
    case "update_required":
      return { status: "update_required", minVersion: k.minVersion };
    case "origin":
    case "no_identity":
      return { status: "blocked", message: k.message };
    default:
      return { status: "reconnecting" };
  }
}

// Traduce onStatus de @devi/client. Si cambian los nombres de estado del cliente, solo se toca esto.
export function fromClient(status: string, err?: unknown): ConnState {
  if (err !== undefined) {
    const s = fromError(err);
    if (s.status !== "reconnecting") return s;
  }
  return status === "open" || status === "connected" ? { status: "connected" } : { status: "reconnecting" };
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
