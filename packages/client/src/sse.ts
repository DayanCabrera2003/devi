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
