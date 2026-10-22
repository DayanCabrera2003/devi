import { afterEach, describe, expect, test } from "bun:test";
import { createClient } from "./client";
import { DeviApiError } from "./errors";
import { fakeServer } from "./fake-server";

const REQUEST = {
  id: "q1", origin: "app", kind: "request", fromMemberId: "m1", fromSessionId: "", fromSessionName: "", toMemberId: "m2", message: "hola",
  status: "pending", files: [{ id: "f1", name: "a.txt", size: 6, direction: "request" }], responseFiles: [],
  createdAt: 1, sentAt: 1, deadline: 2,
};

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

describe("sendFromApp", () => {
  test("manda multipart a POST /requests con meta y archivos y valida la solicitud", async () => {
    let meta: unknown;
    let files: [string, string][] = [];
    const srv = serve(async (req) => {
      const form = await req.formData();
      meta = JSON.parse(String(form.get("meta")));
      files = await Promise.all((form.getAll("files") as File[]).map(async (f) => [f.name, await f.text()] as [string, string]));
      return Response.json(REQUEST);
    });
    const r = await createClient({ baseUrl: srv.url, origin: "tauri://localhost" }).sendFromApp(
      { to: "m2", message: "hola" },
      [{ name: "a.txt", content: "ñandú" }],
    );
    expect(r).toEqual({ ...REQUEST, origin: "app" } as typeof r);
    expect(srv.seen[0]).toMatchObject({ method: "POST", path: "/api/v1/requests" });
    // En el webview el Origin lo pone el navegador; en Bun, la opción interna de tests.
    expect(srv.seen[0]!.headers.get("Origin")).toBe("tauri://localhost");
    expect(srv.seen[0]!.headers.get("Content-Type")).toContain("multipart/form-data");
    expect(meta).toEqual({ to: "m2", message: "hola" });
    expect(files).toEqual([["a.txt", "ñandú"]]);
  });

  test("errores del servidor como DeviApiError", async () => {
    const srv = serve(() => Response.json({ error: "solo desde la app", code: "human_only" }, { status: 403 }));
    const err = (await createClient({ baseUrl: srv.url }).sendFromApp({ to: "m2", message: "hola" }, []).catch((e) => e)) as DeviApiError;
    expect(err).toBeInstanceOf(DeviApiError);
    expect(err.status).toBe(403);
    expect(err.body.code).toBe("human_only");
  });
});

describe("conversaciones", () => {
  test("conversations() valida la lista", async () => {
    const item = { memberId: "m2", lastAt: null, lastPreview: null, lastFromMe: false, waitingOnMe: 0 };
    const srv = serve(() => Response.json({ items: [item] }));
    expect(await createClient({ baseUrl: srv.url }).conversations()).toEqual({ items: [item] });
    expect(srv.seen[0]).toMatchObject({ method: "GET", path: "/api/v1/conversations" });
  });

  test("conversation() manda before y limit solo si vienen", async () => {
    const srv = serve(() => Response.json({ requests: [REQUEST], nextBefore: 1 }));
    const c = createClient({ baseUrl: srv.url });
    const p = await c.conversation("m 2", { before: 99, limit: 10 });
    expect(p.requests[0]?.id).toBe("q1");
    expect(p.nextBefore).toBe(1);
    expect(srv.seen[0]!.path).toBe("/api/v1/conversations/m%202");
    expect(srv.seen[0]!.query.get("before")).toBe("99");
    expect(srv.seen[0]!.query.get("limit")).toBe("10");
    await c.conversation("m2");
    expect([...srv.seen[1]!.query.keys()]).toEqual([]);
  });

  test("también por call", async () => {
    const srv = serve(() => Response.json({ requests: [] }));
    expect(await createClient({ baseUrl: srv.url }).call("conversation", { params: { memberId: "m2" }, query: { limit: "5" } })).toEqual({ requests: [] });
    expect(srv.seen[0]!.query.get("limit")).toBe("5");
  });
});
