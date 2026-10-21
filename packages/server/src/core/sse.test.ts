import { describe, expect, test } from "bun:test";
import { SseHub } from "./sse";

async function readChunks(res: Response, n: number): Promise<string> {
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  let out = "";
  for (let i = 0; i < n; i++) out += (await reader.read()).value ?? "";
  reader.releaseLock();
  return out;
}

describe("SseHub", () => {
  test("envía eventos a la clave abierta", async () => {
    const hub = new SseHub();
    const ac = new AbortController();
    const res = hub.open("user:m1", ac.signal);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    expect(hub.isOpen("user:m1")).toBe(true);
    expect(hub.send("user:m1", "team.updated", { type: "team.updated" })).toBe(true);
    const text = await readChunks(res, 2);
    expect(text).toContain(": connected");
    expect(text).toContain('event: team.updated\ndata: {"type":"team.updated"}');
    ac.abort();
    expect(hub.isOpen("user:m1")).toBe(false);
  });

  test("send a una clave cerrada devuelve false", () => {
    expect(new SseHub().send("session:x", "deliver", {})).toBe(false);
  });

  test("si el cliente cancela la lectura, la clave se cierra (presencia fiable)", async () => {
    const hub = new SseHub();
    const res = hub.open("user:m2", new AbortController().signal);
    await res.body!.cancel();
    expect(hub.isOpen("user:m2")).toBe(false);
  });

  test("onOpen y onClose", () => {
    const hub = new SseHub();
    const log: string[] = [];
    const ac = new AbortController();
    hub.open("k", ac.signal, { onOpen: () => log.push("open"), onClose: () => log.push("close") });
    ac.abort();
    expect(log).toEqual(["open", "close"]);
  });
});
