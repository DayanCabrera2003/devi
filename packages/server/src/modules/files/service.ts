import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FileMeta, Settings } from "@devi/protocol";
import { HttpError } from "../../core/http";
import type { FilesService, ValidFile, WrittenFile } from "../../core/services";
import type { FilesStore } from "./store";
import { validateFiles } from "./validate";

const DAY = 86_400_000;

export class FileManager implements FilesService {
  constructor(
    private repo: FilesStore,
    private dataDir: string,
    private now: () => number,
    private settings: () => Settings,
  ) {}

  validate(files: File[]): Promise<ValidFile[]> {
    return validateFiles(files);
  }

  // Paso 1: bytes a <dataDir>/files/<id>. Si falla alguno, borra los ya escritos y relanza.
  write(files: ValidFile[]): WrittenFile[] {
    const written: WrittenFile[] = [];
    try {
      if (files.length > 0) mkdirSync(join(this.dataDir, "files"), { recursive: true });
      for (const file of files) {
        const id = crypto.randomUUID();
        const path = `files/${id}`;
        writeFileSync(join(this.dataDir, path), file.bytes);
        written.push({ id, path, file });
      }
    } catch (e) {
      this.removeWritten(written);
      throw e;
    }
    return written;
  }

  // Paso 2: filas con los metadatos (sin tocar el disco).
  record(input: {
    draftId: string;
    direction: "request" | "response";
    authorMemberId: string;
    peerMemberId: string;
    written: WrittenFile[];
  }): FileMeta[] {
    return input.written.map(({ id, path, file: f }) => {
      this.repo.insert({
        id, draftId: input.draftId, requestId: null, direction: input.direction, name: f.name, size: f.size,
        sha256: f.sha256, path, authorMemberId: input.authorMemberId, peerMemberId: input.peerMemberId,
        createdAt: this.now(), releasedAt: null, deletedAt: null,
      });
      return { id, name: f.name, size: f.size, direction: input.direction };
    });
  }

  // Atajo: write + record (sin atomicidad con otras tablas).
  store(input: { draftId: string; direction: "request" | "response"; authorMemberId: string; peerMemberId: string; files: ValidFile[] }): FileMeta[] {
    const written = this.write(input.files);
    try {
      return this.record({ ...input, written });
    } catch (e) {
      this.removeWritten(written);
      throw e;
    }
  }

  removeWritten(written: WrittenFile[]): void {
    for (const w of written) rmSync(join(this.dataDir, w.path), { force: true });
  }

  forDraft(draftId: string): FileMeta[] {
    return this.repo.metasOfDraft(draftId);
  }

  forRequest(requestId: string): { files: FileMeta[]; responseFiles: FileMeta[] } {
    const all = this.repo.metasOfRequest(requestId);
    return { files: all.filter((f) => f.direction === "request"), responseFiles: all.filter((f) => f.direction === "response") };
  }

  attachToRequest(draftId: string, requestId: string): void {
    this.repo.attach(draftId, requestId);
  }

  // Solo las partes: el autor siempre; la otra parte cuando el borrador ya se autorizó.
  download(memberId: string, id: string): { absPath: string; name: string; sha256: string } {
    const f = this.repo.get(id);
    if (!f) throw new HttpError(404, "Archivo desconocido", { code: "not_found" });
    const party = memberId === f.authorMemberId || (f.requestId !== null && memberId === f.peerMemberId);
    if (!party) throw new HttpError(403, "No tienes acceso a este archivo", { code: "forbidden" });
    if (f.deletedAt !== null) throw new HttpError(410, "El archivo ya se borró del servidor (retención)", { code: "gone" });
    return { absPath: join(this.dataDir, f.path), name: f.name, sha256: f.sha256 };
  }

  releaseDraft(draftId: string): void {
    this.repo.releaseDraft(draftId, this.now());
  }

  releaseRequest(requestId: string): void {
    this.repo.releaseRequest(requestId, this.now());
  }

  // Borra del disco lo que cumplió la retención. Devuelve cuántos borró.
  runRetention(): number {
    const s = this.settings();
    const due = this.repo.due(this.now(), s.fileRetentionDays * DAY, s.fileMaxAgeDays * DAY);
    for (const f of due) {
      rmSync(join(this.dataDir, f.path), { force: true });
      this.repo.markDeleted(f.id, this.now());
    }
    return due.length;
  }
}
