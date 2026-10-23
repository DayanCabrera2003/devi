import { afterEach, describe, expect, test } from "bun:test";
import { createClient } from "./client";
import { fakeServer } from "./fake-server";

const MSG = { id: "c1", fromMemberId: "m1", toMemberId: "m2", text: "hola", files: [], createdAt: 1, origin: "app", fromSessionName: "" };

let stops: (() => void)[] = [];
afterEach(() => {
  for (const s of stops) s();
  stops = [];
});
function serve(handler: Parameters<typeof fakeServer>[0]) {
  const srv = fakeServer(handler);
  stops.push(srv.stop);
  return srv;
}

describe("chat", () => {
  test("sendChat manda multipart a POST /chat con meta y archivos", async () => {
    let meta: unknown;
    let names: string[] = [];
    const srv = serve(async (req) => {
      const form = await req.formData();
      meta = JSON.parse(String(form.get("meta")));
      names = (form.getAll("files") as File[]).map((f) => f.name);
      return Response.json(MSG);
    });
    const m = await createClient({ baseUrl: srv.url, origin: "tauri://localhost" }).sendChat({ to: "m2", text: "hola" }, [{ name: "a.md", content: "x" }]);
    expect(m).toEqual(MSG as typeof m);
    expect(srv.seen[0]).toMatchObject({ method: "POST", path: "/api/v1/chat" });
    expect(meta).toEqual({ to: "m2", text: "hola" });
    expect(names).toEqual(["a.md"]);
  });

  test("chatFromSession manda a POST /chat/from-session", async () => {
    let meta: unknown;
    const srv = serve(async (req) => {
      meta = JSON.parse(String((await req.formData()).get("meta")));
      return Response.json({ ...MSG, origin: "session", fromSessionName: "api" });
    });
    const m = await createClient({ baseUrl: srv.url }).chatFromSession({ sessionId: "s1", to: "m2", text: "hola", approval: "chat" }, []);
    expect(m.origin).toBe("session");
    expect(srv.seen[0]).toMatchObject({ method: "POST", path: "/api/v1/chat/from-session" });
    expect(meta).toEqual({ sessionId: "s1", to: "m2", text: "hola", approval: "chat" });
  });

  test("chat pide la página con before y limit", async () => {
    const srv = serve(() => Response.json({ messages: [MSG], nextBefore: 1 }));
    const page = await createClient({ baseUrl: srv.url }).chat("m2", { before: 5, limit: 10 });
    expect(page.messages).toHaveLength(1);
    expect(srv.seen[0]).toMatchObject({ method: "GET", path: "/api/v1/chat/m2" });
    expect(srv.seen[0]!.query.get("before")).toBe("5");
  });
});
