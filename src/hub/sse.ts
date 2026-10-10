// Registro de streams SSE por clave ("user:maria", "session:abc").
// El hub los usa para empujar eventos a ventanas y a MCPs.

type Emit = (chunk: string) => void;

const streams = new Map<string, Set<Emit>>();

export function openStream(
  key: string,
  signal: AbortSignal,
  hooks: { onOpen?: () => void; onClose?: () => void } = {},
): Response {
  let emit: Emit;
  let ping: ReturnType<typeof setInterval>;
  const body = new ReadableStream<string>({
    start(ctrl) {
      emit = (chunk) => {
        try {
          ctrl.enqueue(chunk);
        } catch {
          // stream ya cerrado
        }
      };
      ctrl.enqueue(": connected\n\n");
      let set = streams.get(key);
      if (!set) streams.set(key, (set = new Set()));
      set.add(emit);
      ping = setInterval(() => emit(": ping\n\n"), 20_000);
      signal.addEventListener("abort", () => {
        clearInterval(ping);
        const s = streams.get(key);
        s?.delete(emit);
        if (s && s.size === 0) streams.delete(key);
        hooks.onClose?.();
      });
      hooks.onOpen?.();
    },
  });
  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

export function send(key: string, event: string, data: unknown): boolean {
  const set = streams.get(key);
  if (!set || set.size === 0) return false;
  const chunk = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const emit of set) emit(chunk);
  return true;
}

export function isOpen(key: string): boolean {
  return (streams.get(key)?.size ?? 0) > 0;
}
