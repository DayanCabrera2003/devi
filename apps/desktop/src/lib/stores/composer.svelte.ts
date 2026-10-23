import { FILE_LIMITS, scanForSecrets } from "@devi/protocol";
import { errorMessage } from "../api";
import type {
  ChatMessage,
  ConversationsHttp,
  NativeFiles,
  OutgoingFile,
  PickResult,
  PickedFile,
  RejectedFile,
  ThreadRequest,
} from "../conversations-api";

export type SecretHit = { label: string; excerpt: string; where: string };

// Posibles secretos en lo que va a salir: el mensaje y la vista previa de cada archivo.
export function scanOutgoing(text: string, files: Pick<PickedFile, "name" | "preview">[]): SecretHit[] {
  const hits = scanForSecrets(text).map((s) => ({ ...s, where: "el mensaje" }));
  for (const f of files) hits.push(...scanForSecrets(f.preview).map((s) => ({ ...s, where: f.name })));
  return hits;
}

// message: mensaje del chat (sin plazo ni estados). request: solicitud con plazo, que el otro acepta o rechaza.
export type ComposerMode = "message" | "request";
export type Sent = { kind: "chat"; message: ChatMessage } | { kind: "request"; request: ThreadRequest };

// Barra de escritura de una conversación: texto, adjuntos (tokens de Rust), aviso de secretos y si sale como
// mensaje del chat o como solicitud.
export class ComposerStore {
  to = $state<string | null>(null);
  mode = $state<ComposerMode>("message");
  text = $state("");
  files = $state<PickedFile[]>([]);
  rejected = $state<RejectedFile[]>([]);
  confirmSecrets = $state(false);
  sending = $state(false);
  error = $state<string | null>(null);

  // Rust entrega cada archivo una sola vez: si el envío falla después, se reintenta con lo ya leído.
  private taken: { key: string; files: OutgoingFile[] } | null = null;

  secrets = $derived(scanOutgoing(this.text, this.files));
  canSend = $derived(
    !!this.to && !this.sending && this.text.trim().length > 0 && (this.secrets.length === 0 || this.confirmSecrets),
  );

  // Lo que pasa del máximo de archivos se rechaza y se suelta en Rust.
  add(native: Pick<NativeFiles, "discardFiles">, r: PickResult): void {
    const room = Math.max(0, FILE_LIMITS.maxFiles - this.files.length);
    const kept = r.files.slice(0, room);
    const over = r.files.slice(room);
    this.files = [...this.files, ...kept];
    this.rejected = [
      ...r.rejected,
      ...over.map((f) => ({ name: f.name, reason: `Máximo ${FILE_LIMITS.maxFiles} archivos por mensaje` })),
    ];
    if (over.length > 0) void native.discardFiles(over.map((f) => f.token)).catch(() => {});
  }

  async remove(native: Pick<NativeFiles, "discardFiles">, token: string): Promise<void> {
    this.files = this.files.filter((f) => f.token !== token);
    await native.discardFiles([token]).catch(() => {});
  }

  // Cambiar de conversación vacía la barra y suelta los archivos pendientes.
  async reset(native: Pick<NativeFiles, "discardFiles">, to: string | null = null): Promise<void> {
    const tokens = this.files.map((f) => f.token);
    this.to = to;
    this.mode = "message";
    this.text = "";
    this.files = [];
    this.rejected = [];
    this.confirmSecrets = false;
    this.error = null;
    this.taken = null;
    if (tokens.length > 0) await native.discardFiles(tokens).catch(() => {});
  }

  async send(http: Pick<ConversationsHttp, "sendFromApp" | "sendChat">, native: Pick<NativeFiles, "takeFiles">): Promise<Sent | null> {
    if (!this.canSend || !this.to) return null;
    this.sending = true;
    this.error = null;
    try {
      const tokens = this.files.map((f) => f.token);
      const key = tokens.join("|");
      const contents =
        tokens.length === 0 ? [] : this.taken?.key === key ? this.taken.files : await native.takeFiles(tokens);
      this.taken = { key, files: contents };
      const text = this.text.trim();
      const r: Sent =
        this.mode === "message"
          ? { kind: "chat", message: await http.sendChat({ to: this.to, text }, contents) }
          : { kind: "request", request: await http.sendFromApp({ to: this.to, message: text }, contents) };
      this.text = "";
      this.files = [];
      this.rejected = [];
      this.confirmSecrets = false;
      this.taken = null;
      return r;
    } catch (e) {
      this.error = errorMessage(e);
      return null;
    } finally {
      this.sending = false;
    }
  }
}

// Archivos arrastrados sobre la ventana.
export class DragState {
  active = $state(false);
}
