import { ErrorBodySchema } from "@devi/protocol";
import { DeviApiError } from "./errors";

// SSE sobre fetch (no EventSource): funciona igual en Bun y en el webview de Tauri,
// y permite mandar cabeceras (versión, usuario de dev).
export type SseFrame = { event: string; data: string };
export type SseStatus = "connecting" | "open" | "reconnecting" | "failed";
// Errores HTTP que no se arreglan reintentando: sin identidad, sin permiso o versión incompatible.
const FATAL_STATUS: ReadonlySet<number> = new Set([401, 403, 426]);
export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

// Parser incremental: recibe trozos de texto y emite un frame por cada bloque terminado en línea vacía.
export function createSseParser(onFrame: (f: SseFrame) => void): (chunk: string) => void {
  let buf = "";
  let heldCr = false; // un \r al final del trozo anterior: puede ser la mitad de un \r\n
  return (chunk) => {
    if (heldCr) chunk = "\r" + chunk;
    heldCr = chunk.endsWith("\r");
    if (heldCr) chunk = chunk.slice(0, -1);
    buf += chunk.replace(/\r\n?/g, "\n");
    let i: number;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      let event = "message";
      const data: string[] = [];
      for (const line of block.split("\n")) {
        if (line === "" || line.startsWith(":")) continue; // comentario o ping
        const colon = line.indexOf(":");
        const field = colon < 0 ? line : line.slice(0, colon);
        let value = colon < 0 ? "" : line.slice(colon + 1);
        if (value.startsWith(" ")) value = value.slice(1);
        if (field === "event") event = value;
        else if (field === "data") data.push(value);
      }
      if (data.length > 0) {
        try {
          onFrame({ event, data: data.join("\n") });
        } catch (e) {
          // un handler defectuoso no debe tumbar el stream ni los frames que siguen
          console.error("Error en el manejador de un frame SSE:", e);
        }
      }
    }
  };
}

// Espera exponencial: base, 2·base, 4·base… hasta max.
export function backoffDelay(attempt: number, baseMs: number, maxMs: number): number {
  return Math.min(maxMs, baseMs * 2 ** attempt);
}

export type SubscribeSseOptions = {
  url: string;
  headers: Record<string, string>;
  fetch: FetchFn;
  onFrame: (f: SseFrame) => void;
  // "failed" lleva el DeviApiError y es terminal: no se vuelve a intentar.
  onStatus?: (s: SseStatus, err?: DeviApiError) => void;
  baseDelayMs?: number;
  maxDelayMs?: number;
  // Opción interna: sin ningún trozo en este tiempo se aborta y se reconecta (el servidor hace ping cada 20 s).
  idleTimeoutMs?: number;
};

// Abre el stream y lo reabre con espera exponencial si se cae o el servidor responde con error.
// Devuelve la función para cancelar: aborta la conexión y no vuelve a intentarlo.
export function subscribeSse(opts: SubscribeSseOptions): () => void {
  const base = opts.baseDelayMs ?? 1000;
  const max = opts.maxDelayMs ?? 30_000;
  const idleMs = opts.idleTimeoutMs ?? 45_000;
  let stopped = false;
  let ctrl: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;

  const status = (s: SseStatus, err?: DeviApiError) => {
    if (!stopped) opts.onStatus?.(s, err);
  };

  async function connectOnce(): Promise<void> {
    const own = new AbortController();
    ctrl = own;
    const res = await opts.fetch(opts.url, {
      headers: { Accept: "text/event-stream", ...opts.headers },
      signal: own.signal,
    });
    if (FATAL_STATUS.has(res.status)) {
      const data: unknown = await res.json().catch(() => undefined);
      const r = ErrorBodySchema.safeParse(data);
      throw new DeviApiError(res.status, r.success ? r.data : { error: `El servidor de Devi respondió ${res.status}` });
    }
    if (!res.ok || !res.body) {
      await res.body?.cancel().catch(() => {});
      throw new Error(`SSE ${res.status}`);
    }
    attempt = 0;
    status("open");
    // Si se canceló mientras llegaba la respuesta, ninguna entrega debe salir.
    const parse = createSseParser((f) => {
      if (!stopped) opts.onFrame(f);
    });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let idle: ReturnType<typeof setTimeout> | null = null;
    const arm = () => {
      if (idle) clearTimeout(idle);
      idle = setTimeout(() => own.abort(), idleMs);
    };
    try {
      arm();
      while (!stopped) {
        const { value, done } = await reader.read();
        if (done) return;
        arm();
        parse(decoder.decode(value, { stream: true }));
      }
    } finally {
      if (idle) clearTimeout(idle);
      own.abort(); // siempre se cierra el stream viejo antes de reconectar
    }
  }

  async function loop(): Promise<void> {
    status("connecting");
    while (!stopped) {
      try {
        await connectOnce();
      } catch (e) {
        // error fatal: se avisa y se para; el resto (red, 5xx, abort) se decide abajo
        if (e instanceof DeviApiError && !stopped) {
          status("failed", e);
          return;
        }
      }
      if (stopped) return;
      status("reconnecting");
      const delay = backoffDelay(attempt++, base, max);
      await new Promise<void>((resolve) => {
        timer = setTimeout(resolve, delay);
      });
    }
  }

  void loop();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    ctrl?.abort();
  };
}
