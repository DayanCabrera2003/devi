import { afterEach, describe, expect, test } from "bun:test";
import { API_VERSION } from "@devi/protocol";
import { createClient } from "./client";
import { DeviApiError } from "./errors";
import { fakeServer } from "./fake-server";

const ME = {
  login: "maria@dev",
  member: { id: "m1", login: "maria@dev", name: "María", description: "", roleIds: [], disabled: false },
  roles: [],
  perms: ["requests.send"],
};
const DRAFT = {
  id: "d1", kind: "request", toMemberId: "m2", authorMemberId: "m1", authorSessionId: "s1", message: "hola",
  status: "awaiting", files: [{ id: "f1", name: "a.txt", size: 4, direction: "request" }], createdAt: 1, expiresAt: 2,
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

describe("call", () => {
  test("manda versión por cabecera y ?v=, usuario de dev, y valida la respuesta", async () => {
    const srv = serve(() => Response.json(ME));
    const me = await createClient({ baseUrl: `${srv.url}/`, devUser: "maria@dev" }).call("me");
    expect(me.member.name).toBe("María");
    const req = srv.seen[0]!;
    expect(req.path).toBe("/api/v1/me");
    expect(req.query.get("v")).toBeNull(); // fuera de los SSE la versión va solo en la cabecera
    expect(req.headers.get("X-Devi-Version")).toBe(API_VERSION);
    expect(req.headers.get("X-Devi-Dev-User")).toBe("maria@dev");
  });

  test("sin devUser no manda la cabecera de dev", async () => {
    const srv = serve(() => Response.json(ME));
    await createClient({ baseUrl: srv.url }).call("me");
    expect(srv.seen[0]!.headers.get("X-Devi-Dev-User")).toBeNull();
  });

  test("sustituye parámetros y manda el cuerpo JSON", async () => {
    let body: unknown;
    const srv = serve(async (req) => {
      body = await req.json();
      return Response.json({ ok: true });
    });
    const r = await createClient({ baseUrl: srv.url }).call("sessionHook", {
      body: { claudeSessionId: "c1", cwd: "/x", parentPid: 42, status: "working" },
    });
    expect(r).toEqual({ ok: true });
    expect(srv.seen[0]!.method).toBe("POST");
    expect(body).toEqual({ claudeSessionId: "c1", cwd: "/x", parentPid: 42, status: "working" });

    const srv2 = serve(() => Response.json([]));
    await createClient({ baseUrl: srv2.url }).call("memberSessions", { params: { id: "m 1" } });
    expect(srv2.seen[0]!.path).toBe("/api/v1/members/m%201/sessions");
  });

  test("un error del servidor se convierte en DeviApiError con su cuerpo", async () => {
    const srv = serve(() => Response.json({ error: "Pide al admin", code: "unknown_login", login: "x@y" }, { status: 403 }));
    const err = await createClient({ baseUrl: srv.url }).call("me").catch((e) => e);
    expect(err).toBeInstanceOf(DeviApiError);
    expect(err.status).toBe(403);
    expect(err.body).toEqual({ error: "Pide al admin", code: "unknown_login", login: "x@y" });
    expect(err.message).toBe("Tu login de Tailscale (x@y) no está en el equipo de Devi: pide al admin que te añada.");
  });

  test("traduce 401, 403 (permiso, origen) y 426 a mensajes legibles", async () => {
    const cases: [number, object, string][] = [
      [401, { error: "x", code: "no_identity" }, "no pudo identificarte"],
      [403, { error: "x", code: "missing_perm", perm: "files.send" }, 'Te falta el permiso "files.send" (Enviar archivos)'],
      [403, { error: "x", code: "origin" }, "rechazó el origen"],
      [426, { error: "x", code: "version", minVersion: "2.0.0" }, "actualiza Devi"],
      [409, { error: "La solicitud ya está respondida", code: "conflict" }, "La solicitud ya está respondida"],
    ];
    for (const [status, body, text] of cases) {
      const srv = serve(() => Response.json(body, { status }));
      const err = await createClient({ baseUrl: srv.url }).call("me").catch((e) => e);
      expect(err.status).toBe(status);
      expect(err.message).toContain(text);
    }
  });

  test("un error sin cuerpo JSON también es legible", async () => {
    const srv = serve(() => new Response("boom", { status: 502 }));
    const err = await createClient({ baseUrl: srv.url }).call("me").catch((e) => e);
    expect(err.body.error).toBe("El servidor de Devi respondió 502");
  });

  test("respuesta que no cumple el esquema → bad_response", async () => {
    const srv = serve(() => Response.json({ nope: true }));
    const err = await createClient({ baseUrl: srv.url }).call("me").catch((e) => e);
    expect(err).toBeInstanceOf(DeviApiError);
    expect(err.body.code).toBe("bad_response");
  });

  test("servidor inalcanzable → status 0 y code unreachable", async () => {
    const srv = serve(() => new Response());
    const url = srv.url;
    srv.stop();
    const err = await createClient({ baseUrl: url }).call("me").catch((e) => e);
    expect(err).toBeInstanceOf(DeviApiError);
    expect(err.status).toBe(0);
    expect(err.body.code).toBe("unreachable");
  });

  test("rutas z.any() devuelven el valor sin validar", async () => {
    const srv = serve(() => new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "application/octet-stream" } }));
    const bytes = (await createClient({ baseUrl: srv.url }).call("exportDb")) as ArrayBuffer;
    expect([...new Uint8Array(bytes)]).toEqual([1, 2, 3]);
  });
});

describe("createDraft y downloadFile", () => {
  test("createDraft manda multipart con meta y archivos", async () => {
    let meta: unknown;
    let files: [string, string][] = [];
    const srv = serve(async (req) => {
      const form = await req.formData();
      meta = JSON.parse(String(form.get("meta")));
      files = await Promise.all((form.getAll("files") as File[]).map(async (f) => [f.name, await f.text()] as [string, string]));
      return Response.json(DRAFT);
    });
    const draft = await createClient({ baseUrl: srv.url }).createDraft(
      { kind: "request", sessionId: "s1", to: "m2", message: "hola" },
      [{ name: "a.txt", content: "ñandú" }],
    );
    expect(draft.id).toBe("d1");
    expect(srv.seen[0]!.path).toBe("/api/v1/drafts");
    expect(srv.seen[0]!.headers.get("X-Devi-Version")).toBe(API_VERSION);
    expect(meta).toEqual({ kind: "request", sessionId: "s1", to: "m2", message: "hola" });
    expect(files).toEqual([["a.txt", "ñandú"]]);
  });

  test("downloadFile devuelve el texto", async () => {
    const srv = serve(() => new Response("contenido ✓", { headers: { "Content-Type": "text/plain; charset=utf-8" } }));
    expect(await createClient({ baseUrl: srv.url }).downloadFile("f1")).toBe("contenido ✓");
    expect(srv.seen[0]!.path).toBe("/api/v1/files/f1");
  });
});
