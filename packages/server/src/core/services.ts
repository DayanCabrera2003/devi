import type { FileMeta, Session, Settings } from "@devi/protocol";

// Servicios que un módulo ofrece a los demás a través de ModuleContext.services.
// Así ningún módulo importa a otro: solo dependen de estas interfaces del núcleo.

export type MemberInfo = { id: string; login: string; name: string; disabled: boolean };

export interface TeamService {
  member(id: string): MemberInfo | null;
  nameOf(id: string): string; // nombre visible; si no existe, el propio id
  memberIds(): string[];
}

export interface SettingsService {
  get(): Settings;
}

export interface SessionsService {
  get(id: string): Session | null; // aunque no esté viva
  isAlive(id: string): boolean;
  liveOf(memberId: string): Session[];
  hasLive(memberId: string): boolean;
}

// Archivo ya validado (nombre saneado, bytes en memoria, hash calculado).
export type ValidFile = { name: string; bytes: Uint8Array; size: number; sha256: string };

export interface FilesService {
  validate(files: File[]): Promise<ValidFile[]>; // lanza HttpError 400 si alguno no vale
  store(input: {
    draftId: string;
    direction: "request" | "response";
    authorMemberId: string; // puede descargarlo siempre
    peerMemberId: string; // puede descargarlo cuando el borrador se autoriza
    files: ValidFile[];
  }): FileMeta[];
  forDraft(draftId: string): FileMeta[];
  forRequest(requestId: string): { files: FileMeta[]; responseFiles: FileMeta[] };
  attachToRequest(draftId: string, requestId: string): void;
}

export interface ServiceMap {
  team: TeamService;
  settings: SettingsService;
  sessions: SessionsService;
  files: FilesService;
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
