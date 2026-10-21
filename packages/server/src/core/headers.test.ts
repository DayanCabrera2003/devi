import { afterEach, describe, expect, test } from "bun:test";
import { API_VERSION } from "@devi/protocol";
import { setupFlow, type Flow } from "../modules/requests/fixture";

let f: Flow;
afterEach(() => f.cleanup());

const CSP = "default-src 'none'; frame-ancestors 'none'";
const expectBase = (h: Headers) => {
  expect(h.get("X-Content-Type-Options")).toBe("nosniff");
  expect(h.get("Referrer-Policy")).toBe("no-referrer");
  expect(h.get("Cache-Control")).toBe("no-store");
};

describe("cabeceras de seguridad", () => {
  test("JSON (éxito y error), health, 404 y preflight", async () => {
    f = await setupFlow();
    for (const res of [
      await f.call("dayan@dev", "GET", "/api/v1/members/m-maria/sessions"),
      await f.call("nadie@dev", "GET", "/api/v1/members/m-maria/sessions"),
      await f.call("dayan@dev", "GET", "/api/v1/no-existe"),
    ]) {
      expectBase(res.headers);
      expect(res.headers.get("Content-Security-Policy")).toBe(CSP);
    }
    const health = await f.app.fetch(new Request("http://127.0.0.1/api/v1/health"));
    expectBase(health.headers);
    expect(health.headers.get("Content-Security-Policy")).toBe(CSP);
    const pre = await f.app.fetch(new Request("http://127.0.0.1/api/v1/drafts", { method: "OPTIONS", headers: { Origin: "tauri://localhost" } }));
    expect(pre.status).toBe(204);
    expect(pre.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(pre.headers.get("Access-Control-Allow-Origin")).toBe("tauri://localhost");
  });

  test("descargas: attachment, texto UTF-8 y CSP", async () => {
    f = await setupFlow();
    const r = await f.pendingRequest("con archivo", [new File(["hola"], "../evil.html")]);
    const fileId = (await f.getRequest(r.id)).files[0].id;
    const res = await f.call("maria@dev", "GET", `/api/v1/files/${fileId}`);
    expect(res.status).toBe(200);
    expectBase(res.headers);
    expect(res.headers.get("Content-Security-Policy")).toBe(CSP);
    expect(res.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toStartWith("attachment;");
  });

  test("el SSE sigue funcionando (stream abierto, tipo event-stream, eventos llegan)", async () => {
    f = await setupFlow();
    const ac = new AbortController();
    const res = await f.app.fetch(
      new Request(`http://127.0.0.1/api/v1/events/user?v=${API_VERSION}&devUser=maria@dev`, { signal: ac.signal }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    expectBase(res.headers);
    const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
    expect((await reader.read()).value).toContain(": connected");
    await f.pendingRequest("hola");
    let text = "";
    while (!text.includes("request.incoming")) text += (await reader.read()).value ?? "";
    ac.abort();
  });
});
