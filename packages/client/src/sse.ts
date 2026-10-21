// SSE sobre fetch (no EventSource): funciona igual en Bun y en el webview de Tauri,
// y permite mandar cabeceras (versión, usuario de dev).
export type SseFrame = { event: string; data: string };
export type SseStatus = "connecting" | "open" | "reconnecting";
export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

// Parser incremental: recibe trozos de texto y emite un frame por cada bloque terminado en línea vacía.
export function createSseParser(onFrame: (f: SseFrame) => void): (chunk: string) => void {
  let buf = "";
  return (chunk) => {
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
      if (data.length > 0) onFrame({ event, data: data.join("\n") });
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
  onStatus?: (s: SseStatus) => void;
  baseDelayMs?: number;
  maxDelayMs?: number;
};

// Abre el stream y lo reabre con espera exponencial si se cae o el servidor responde con error.
// Devuelve la función para cancelar: aborta la conexión y no vuelve a intentarlo.
export function subscribeSse(opts: SubscribeSseOptions): () => void {
  const base = opts.baseDelayMs ?? 1000;
  const max = opts.maxDelayMs ?? 30_000;
  let stopped = false;
  let ctrl: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;

  const status = (s: SseStatus) => {
    if (!stopped) opts.onStatus?.(s);
  };

  async function connectOnce(): Promise<void> {
    ctrl = new AbortController();
    const res = await opts.fetch(opts.url, {
      headers: { Accept: "text/event-stream", ...opts.headers },
      signal: ctrl.signal,
    });
    if (!res.ok || !res.body) {
      await res.body?.cancel().catch(() => {});
      throw new Error(`SSE ${res.status}`);
    }
    attempt = 0;
    status("open");
    const parse = createSseParser(opts.onFrame);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { value, done } = await reader.read();
      if (done) return;
      parse(decoder.decode(value, { stream: true }));
    }
  }

  async function loop(): Promise<void> {
    status("connecting");
    while (!stopped) {
      try {
        await connectOnce();
      } catch {
        // caída de red, error HTTP o abort: se decide abajo
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
