// Acceso al servidor de Devi desde la app: envuelve @devi/client (que pone X-Devi-Version y,
// en dev, X-Devi-Dev-User) con métodos tipados y traduce los errores a algo que la UI muestra.
import { createClient } from "@devi/client";
import {
  API,
  API_VERSION,
  PERM_LABELS,
  VERSION_HEADER,
  type ApiRoute,
  type CreateMemberBody,
  type CreateRoleBody,
  type DeviRequest,
  type Draft,
  type ErrorBody,
  type Me,
  type Member,
  type Role,
  type Session,
  type Settings,
  type TeamView,
  type UpdateMemberBody,
  type UpdateRoleBody,
  type UserEvent,
} from "@devi/protocol";
import type { z } from "zod";
import type { ClientConfig } from "./native";

export type MemberBody = z.input<typeof CreateMemberBody>;
export type MemberPatch = z.input<typeof UpdateMemberBody>;
export type RoleBody = z.input<typeof CreateRoleBody>;
export type RolePatch = z.input<typeof UpdateRoleBody>;

// ---- errores -------------------------------------------------------------------

type ApiFailure = { status: number; body: ErrorBody };

// DeviApiError de @devi/client tiene { status, body }: se reconoce por su forma.
export function isApiFailure(e: unknown): e is ApiFailure {
  if (typeof e !== "object" || e === null) return false;
  const x = e as { status?: unknown; body?: unknown };
  return typeof x.status === "number" && typeof x.body === "object" && x.body !== null;
}

export class HttpFailure extends Error {
  readonly status: number;
  readonly body: ErrorBody;
  constructor(status: number, body: ErrorBody) {
    super(body.error);
    this.status = status;
    this.body = body;
  }
}

export type ErrorInfo =
  | { kind: "unknown_login"; login: string; message: string }
  | { kind: "update_required"; minVersion: string; message: string }
  | { kind: "origin"; message: string }
  | { kind: "no_identity"; message: string }
  | { kind: "missing_perm"; perm: string; message: string }
  | { kind: "conflict"; message: string }
  | { kind: "network"; message: string }
  | { kind: "other"; message: string };

export function classifyError(e: unknown): ErrorInfo {
  if (isApiFailure(e)) {
    const b = e.body;
    const msg = typeof b.error === "string" && b.error ? b.error : `Error ${e.status} del servidor de Devi`;
    // status 0: @devi/client no llegó al servidor (red caída o timeout).
    if (e.status === 0) return { kind: "network", message: msg };
    if (e.status === 403 && b.code === "unknown_login") return { kind: "unknown_login", login: b.login ?? "", message: msg };
    if (e.status === 403 && b.code === "origin") {
      return {
        kind: "origin",
        message:
          "El servidor de Devi rechazó el origen de esta app. Usa la app instalada; en desarrollo, Vite debe estar en el puerto 1420 y el servidor en modo --dev.",
      };
    }
    if (e.status === 403 && b.code === "missing_perm") {
      const perm = b.perm ?? "";
      const label = (PERM_LABELS as Record<string, string>)[perm] ?? perm;
      return { kind: "missing_perm", perm, message: `Te falta el permiso «${label}». Pídeselo al admin de Devi.` };
    }
    if (e.status === 401) {
      return {
        kind: "no_identity",
        message:
          "El servidor no sabe quién eres. Conéctate con la URL https://<equipo>.<tailnet>.ts.net (no con 127.0.0.1), con Tailscale activo y `tailscale serve` configurado en el servidor.",
      };
    }
    if (e.status === 426 || b.code === "version") return { kind: "update_required", minVersion: b.minVersion ?? "", message: msg };
    if (e.status === 409) return { kind: "conflict", message: msg };
    return { kind: "other", message: msg };
  }
  if (e instanceof TypeError) {
    return { kind: "network", message: "No se pudo conectar con el servidor de Devi (¿está Tailscale activo y el servidor encendido?)" };
  }
  if (e instanceof Error) return { kind: "other", message: e.message };
  if (typeof e === "string") return { kind: "other", message: e }; // los comandos Rust rechazan con texto
  return { kind: "other", message: String(e) };
}

export const errorMessage = (e: unknown): string => classifyError(e).message;

// ---- cliente -------------------------------------------------------------------

// Contrato con @devi/client.subscribeUser: onStatus("open") al (re)conectar, antes de los
// eventos reenviados; "reconnecting" al perder la conexión; ("failed", err) en 401/403/426.
export type StatusListener = (status: string, err?: unknown) => void;

export interface ClientLike {
  call(name: ApiRoute, opts: { params?: Record<string, string>; body?: unknown }): Promise<unknown>;
  downloadFile(id: string): Promise<string>;
  subscribeUser(onEvent: (e: UserEvent) => void, opts?: { onStatus?: StatusListener }): () => void;
}

export class DeviApi {
  private readonly client: ClientLike;
  readonly baseUrl: string;
  private readonly devUser: string | undefined;

  constructor(client: ClientLike, baseUrl: string, devUser?: string) {
    this.client = client;
    this.baseUrl = baseUrl;
    this.devUser = devUser;
  }

  private call<T>(name: ApiRoute, opts: { params?: Record<string, string>; body?: unknown } = {}): Promise<T> {
    return this.client.call(name, opts) as Promise<T>;
  }

  health() { return this.call<{ ok: true; version: string }>("health"); }
  me() { return this.call<Me>("me"); }
  team() { return this.call<TeamView>("team"); }
  memberSessions(memberId: string) { return this.call<Session[]>("memberSessions", { params: { id: memberId } }); }

  authorizeDraft(id: string) { return this.call<Draft>("authorizeDraft", { params: { id }, body: {} }); }
  discardDraft(id: string) { return this.call<Draft>("discardDraft", { params: { id }, body: {} }); }

  forwardRequest(id: string, sessionId: string) {
    return this.call<DeviRequest>("forwardRequest", { params: { id }, body: { sessionId } });
  }
  acceptRequest(id: string, note?: string) {
    return this.call<DeviRequest>("acceptRequest", { params: { id }, body: note ? { note } : {} });
  }
  rejectRequest(id: string, reason: string) {
    return this.call<DeviRequest>("rejectRequest", { params: { id }, body: { reason } });
  }
  acceptResponse(id: string) { return this.call<DeviRequest>("acceptResponse", { params: { id }, body: {} }); }
  forwardResponse(id: string, sessionId: string) {
    return this.call<DeviRequest>("forwardResponse", { params: { id }, body: { sessionId } });
  }
  resendRequest(id: string) { return this.call<DeviRequest>("resendRequest", { params: { id }, body: {} }); }
  ignoreRequest(id: string) { return this.call<DeviRequest>("ignoreRequest", { params: { id }, body: {} }); }

  createMember(body: MemberBody) { return this.call<Member>("createMember", { body }); }
  updateMember(id: string, body: MemberPatch) { return this.call<Member>("updateMember", { params: { id }, body }); }
  createRole(body: RoleBody) { return this.call<Role>("createRole", { body }); }
  updateRole(id: string, body: RolePatch) { return this.call<Role>("updateRole", { params: { id }, body }); }
  deleteRole(id: string) { return this.call<{ ok: true }>("deleteRole", { params: { id }, body: {} }); }
  getSettings() { return this.call<Settings>("getSettings"); }
  updateSettings(body: Partial<Settings>) { return this.call<Settings>("updateSettings", { body }); }

  downloadFile(id: string) { return this.client.downloadFile(id); }

  subscribe(onEvent: (e: UserEvent) => void, onStatus: StatusListener): () => void {
    return this.client.subscribeUser(onEvent, { onStatus });
  }

  // Binario (application/octet-stream): se pide con fetch directo y las mismas cabeceras.
  async exportDb(): Promise<Uint8Array> {
    const headers: Record<string, string> = { [VERSION_HEADER]: API_VERSION };
    if (this.devUser) headers["X-Devi-Dev-User"] = this.devUser;
    const res = await fetch(new URL(API.exportDb.path, this.baseUrl), { headers });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as ErrorBody | null;
      throw new HttpFailure(res.status, body ?? { error: `Error ${res.status} al exportar la base de datos` });
    }
    return new Uint8Array(await res.arrayBuffer());
  }
}

export function createDeviApi(config: ClientConfig): DeviApi {
  const client = createClient({ baseUrl: config.serverUrl, devUser: config.devUser }) as unknown as ClientLike;
  return new DeviApi(client, config.serverUrl, config.devUser);
}
