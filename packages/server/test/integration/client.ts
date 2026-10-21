import { API_VERSION } from "@devi/protocol";

// Cliente HTTP + SSE de pruebas que habla con un servidor real (Bun.serve) como lo harán la app y el MCP:
// X-Devi-Version en todas las peticiones; en los SSE, además, ?v=. Identidad dev por X-Devi-Dev-User.

export type SseEvent = { event: string; data: any };

export function client(base: string, login: string) {
  const headers = { "X-Devi-Version": API_VERSION, "X-Devi-Dev-User": login };

  async function call(method: string, path: string, body?: unknown) {
    const init: RequestInit = { method, headers };
    if (body instanceof FormData) init.body = body;
    else if (body !== undefined) {
      init.body = JSON.stringify(body);
      init.headers = { ...headers, "Content-Type": "application/json" };
    }
    const res = await fetch(`${base}${path}`, init);
    const text = await res.text();
    let data: any = text;
    try {
      data = JSON.parse(text);
    } catch {
      // descarga de texto
    }
    return { status: res.status, data, headers: res.headers };
  }

  // Abre un SSE y va guardando los eventos. waitFor espera (tiempo real, máx. 3 s) al primero que cumpla pred.
  async function sse(path: string) {
    const ac = new AbortController();
    const res = await fetch(`${base}${path}?v=${API_VERSION}`, { headers, signal: ac.signal });
    if (res.status !== 200) throw new Error(`SSE ${path} → ${res.status}`);
    const events: SseEvent[] = [];
    (async () => {
      const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buf += value;
        let i: number;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const event = /^event: (.*)$/m.exec(block)?.[1];
          const data = /^data: (.*)$/m.exec(block)?.[1];
          if (event && data) events.push({ event, data: JSON.parse(data) });
        }
      }
    })().catch(() => {});

    async function waitFor(pred: (e: SseEvent) => boolean, label: string): Promise<SseEvent> {
      const deadline = Date.now() + 3_000;
      for (;;) {
        const found = events.find(pred);
        if (found) return found;
        if (Date.now() > deadline) throw new Error(`no llegó: ${label}`);
        await Bun.sleep(10);
      }
    }

    return { events, waitFor, close: () => ac.abort() };
  }

  return { login, call, sse };
}

export function draftForm(meta: object, files: File[] = []): FormData {
  const form = new FormData();
  form.set("meta", JSON.stringify(meta));
  for (const f of files) form.append("files", f);
  return form;
}
