// Servidor falso para los tests del cliente: Bun.serve en un puerto libre que registra
// cada petición y responde con el handler que le pase el test.
export type Seen = { method: string; path: string; query: URLSearchParams; headers: Headers };

export function fakeServer(handler: (req: Request, url: URL) => Response | Promise<Response>) {
  const seen: Seen[] = [];
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    idleTimeout: 0,
    fetch(req) {
      const url = new URL(req.url);
      seen.push({ method: req.method, path: url.pathname, query: url.searchParams, headers: req.headers });
      return handler(req, url);
    },
  });
  return { url: `http://127.0.0.1:${server.port}`, seen, stop: () => server.stop(true) };
}

// Respuesta SSE que emite los frames dados y, si close=true, cierra el stream al terminar.
export function sseResponse(frames: { event: string; data: unknown }[], close: boolean, signal?: AbortSignal): Response {
  const body = new ReadableStream<string>({
    start(ctrl) {
      ctrl.enqueue(": connected\n\n");
      for (const f of frames) ctrl.enqueue(`event: ${f.event}\ndata: ${JSON.stringify(f.data)}\n\n`);
      if (close) ctrl.close();
      else signal?.addEventListener("abort", () => ctrl.close());
    },
  });
  return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
}
