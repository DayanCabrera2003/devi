import type { AuditAction, AuditTarget, FileMeta, Session, SessionDelivery, Settings } from "@devi/protocol";

// Servicios que un módulo ofrece a los demás a través de ModuleContext.services.
// Así ningún módulo importa a otro: solo dependen de estas interfaces del núcleo.

export type MemberInfo = { id: string; login: string; name: string; disabled: boolean };

export interface TeamService {
  member(id: string): MemberInfo | null;
  nameOf(id: string): string; // nombre visible; si no existe, el propio id
  memberIds(): string[];
  adminIds(): string[]; // personas activas con team.admin (reciben las alertas de auditoría)
}

export interface SettingsService {
  get(): Settings;
}

export interface SessionsService {
  get(id: string): Session | null; // aunque no esté viva
  isAlive(id: string): boolean;
  liveOf(memberId: string): Session[];
  hasLive(memberId: string): boolean;
  // Guarda la entrega en la bandeja de la sesión (salvo debug) y la devuelve con meta.inbox_id.
  enqueue(sessionId: string, d: SessionDelivery): SessionDelivery;
}

// Archivo ya validado (nombre saneado, bytes en memoria, hash calculado).
export type ValidFile = { name: string; bytes: Uint8Array; size: number; sha256: string };

export type WrittenFile = { id: string; path: string; file: ValidFile };

export interface FilesService {
  validate(files: File[]): Promise<ValidFile[]>; // lanza HttpError 400 si alguno no vale
  // En dos pasos para poder crear borradores de forma atómica: primero se escriben los bytes en disco
  // (si falla uno, se borran los ya escritos y se relanza) y después se registran las filas (dentro de la
  // transacción del llamador). Si algo falla, el llamador borra lo escrito con removeWritten().
  write(files: ValidFile[]): WrittenFile[];
  record(input: {
    draftId: string;
    direction: "request" | "response";
    authorMemberId: string; // puede descargarlo siempre
    peerMemberId: string; // puede descargarlo cuando el borrador se autoriza
    written: WrittenFile[];
  }): FileMeta[];
  // Como record, pero para una solicitud enviada desde la app (sin borrador): quedan ya unidos a la
  // solicitud y la otra parte puede descargarlos desde el principio.
  recordForRequest(input: {
    requestId: string;
    direction: "request" | "response";
    authorMemberId: string;
    peerMemberId: string;
    written: WrittenFile[];
  }): FileMeta[];
  removeWritten(written: WrittenFile[]): void;
  forDraft(draftId: string): FileMeta[];
  forRequest(requestId: string): { files: FileMeta[]; responseFiles: FileMeta[] };
  attachToRequest(draftId: string, requestId: string): void;
  // Archivos de la solicitud (dirección "request") leídos del disco, listos para write + recordForRequest en
  // otra solicitud (pedírsela a otra persona). Los que ya no están en el servidor se omiten.
  readForCopy(requestId: string): ValidFile[];
}

// Una entrada del registro de auditoría. actorMemberId null/ausente = el servidor (caducidades, plazos).
// Si falta actorLogin se toma el login de actorMemberId. Los valores de details se guardan como texto.
export type AuditDetails = Record<string, string | number | boolean | null | undefined>;
export type AuditInput = {
  actorMemberId?: string | null;
  actorLogin?: string;
  action: AuditAction;
  targetType: AuditTarget;
  targetId?: string | null;
  details?: AuditDetails;
  alert?: boolean; // forzar (o quitar) la alerta a los admins; por defecto según la acción
};

export interface AuditService {
  record(input: AuditInput): void; // nunca lanza: un fallo del registro no deshace la acción
  // Login rechazado (desconocido o de otro dominio). Como mucho una entrada por login cada 10 min.
  loginRejected(login: string, reason: "unknown_login" | "domain"): void;
}

export interface ServiceMap {
  team: TeamService;
  settings: SettingsService;
  sessions: SessionsService;
  files: FilesService;
  audit: AuditService;
}

export class ServiceRegistry {
  private impls: Partial<ServiceMap> = {};

  provide<K extends keyof ServiceMap>(name: K, impl: ServiceMap[K]): void {
    if (this.impls[name]) throw new Error(`servicio duplicado: ${name}`);
    this.impls[name] = impl;
  }

  // Para usar en tiempo de petición (no en routes(): el módulo que lo ofrece puede no haberse cargado aún).
  get<K extends keyof ServiceMap>(name: K): ServiceMap[K] {
    const impl = this.impls[name];
    if (!impl) throw new Error(`servicio no registrado: ${name} (¿falta su módulo en MODULES?)`);
    return impl;
  }

  find<K extends keyof ServiceMap>(name: K): ServiceMap[K] | undefined {
    return this.impls[name];
  }
}
