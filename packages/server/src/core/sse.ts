// Streams SSE por clave ("user:<memberId>", "session:<sessionId>").
// Se emiten bytes (no strings) para que cualquier lector (TextDecoderStream, fetch) funcione.
type Emit = (chunk: string) => void;
const encoder = new TextEncoder();

export class SseHub {
  private streams = new Map<string, Set<Emit>>();

  constructor(private pingMs = 20_000) {}

  open(key: string, signal: AbortSignal, hooks: { onOpen?: () => void; onClose?: () => void } = {}): Response {
    const streams = this.streams;
    const pingMs = this.pingMs;
    let cleanup = () => {};
    const body = new ReadableStream<Uint8Array>({
      start(ctrl) {
        const emit: Emit = (chunk) => {
          try {
            ctrl.enqueue(encoder.encode(chunk));
          } catch {
            // stream ya cerrado
          }
        };
        emit(": connected\n\n");
        let set = streams.get(key);
        if (!set) streams.set(key, (set = new Set()));
        set.add(emit);
        const ping = setInterval(() => emit(": ping\n\n"), pingMs);
        let closed = false;
        // Se llama al abortar la petición o cuando el cliente cancela la lectura: lo que llegue antes.
        cleanup = () => {
          if (closed) return;
          closed = true;
          clearInterval(ping);
          const s = streams.get(key);
          s?.delete(emit);
          if (s && s.size === 0) streams.delete(key);
          try {
            ctrl.close();
          } catch {
            // ya cerrado
          }
          hooks.onClose?.();
        };
        signal.addEventListener("abort", cleanup);
        hooks.onOpen?.();
      },
      cancel() {
        cleanup();
      },
    });
    return new Response(body, {
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
    });
  }

  send(key: string, event: string, data: unknown): boolean {
    const set = this.streams.get(key);
    if (!set || set.size === 0) return false;
    const chunk = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const emit of set) emit(chunk);
    return true;
  }

  isOpen(key: string): boolean {
    return (this.streams.get(key)?.size ?? 0) > 0;
  }
}
