import { describe, expect, test } from "bun:test";
import { API, API_VERSION } from "@devi/protocol";
import { z } from "zod";
import { createApp } from "./app";
import { DevIdentity } from "./auth";
import { testConfig } from "./config";
import { HttpError, json } from "./http";
import type { DeviModule } from "./module";

let handlerCalls = 0;
const testModule: DeviModule = {
  name: "test",
  migrations: [{ version: 1, sql: "CREATE TABLE test_t (x TEXT)" }],
  routes(r, ctx) {
    ctx.setAccessResolver((login) =>
      login === "admin@dev"
        ? { memberId: "m-admin", perms: new Set(["team.admin", "requests.send"]) }
        : login === "maria@dev"
          ? { memberId: "m-maria", perms: new Set(["requests.send"]) }
          : null,
    );
    r.on(API.me, ({ access, principal }) => json({ memberId: access.memberId, login: principal.login }));
    r.on(API.getSettings, () => json({ ok: true }));
    r.on(API.userEvents, () => json({ sse: true }));
    r.on(API.createDraft, () => {
      handlerCalls++;
      return json({ ok: true });
    });
    r.on(API.forwardRequest, ({ params }) => {
      if (params.id === "missing") throw new HttpError(404, "no existe");
      z.object({ n: z.number() }).parse({ n: "no" });
      return json({});
    });
  },
};

const make = () => createApp({ identity: new DevIdentity(), modules: [testModule], allowedOrigins: ["tauri://localhost"] });
const call = (app: ReturnType<typeof make>, method: string, path: string, headers: Record<string, string> = {}) =>
  app.fetch(new Request(`http://127.0.0.1${path}`, { method, headers: { "X-Devi-Version": API_VERSION, ...headers } }));

describe("createApp", () => {
  test("health es público y sin versión", async () => {
    const res = await make().fetch(new Request("http://127.0.0.1/api/v1/health"));
    expect(await res.json()).toEqual({ ok: true, version: API_VERSION });
  });

  test("versión incompatible → 426", async () => {
    const res = await call(make(), "GET", "/api/v1/me", { "X-Devi-Version": "2.0.0", "X-Devi-Dev-User": "maria@dev" });
    expect(res.status).toBe(426);
    expect(((await res.json()) as { code: string }).code).toBe("version");
  });

  test("versión por query en la ruta SSE de usuario", async () => {
    const app = make();
    const res = await app.fetch(new Request(`http://127.0.0.1/api/v1/events/user?v=${API_VERSION}&devUser=maria@dev`));
    expect(res.status).toBe(200);
  });

  test("versión por query en una ruta no SSE → 426", async () => {
    const res = await make().fetch(new Request(`http://127.0.0.1/api/v1/me?v=${API_VERSION}`, { headers: { "X-Devi-Dev-User": "maria@dev" } }));
    expect(res.status).toBe(426);
  });

  test("?devUser= en una ruta no SSE → 401", async () => {
    const res = await call(make(), "GET", "/api/v1/me?devUser=maria@dev");
    expect(res.status).toBe(401);
  });

  test("Origin no permitido en POST → 403 sin ejecutar el handler", async () => {
    handlerCalls = 0;
    const res = await call(make(), "POST", "/api/v1/drafts", { Origin: "https://evil.example", "X-Devi-Dev-User": "maria@dev" });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe("origin");
    expect(handlerCalls).toBe(0);
  });

  test("health también rechaza Origin no permitido", async () => {
    const res = await call(make(), "GET", "/api/v1/health", { Origin: "https://evil.example" });
    expect(res.status).toBe(403);
  });

  test("sin Origin (CLI/MCP) → permitido", async () => {
    handlerCalls = 0;
    const res = await call(make(), "POST", "/api/v1/drafts", { "X-Devi-Dev-User": "maria@dev" });
    expect(res.status).toBe(200);
    expect(handlerCalls).toBe(1);
  });

  test("sin identidad → 401; login desconocido → 403 con login", async () => {
    const app = make();
    expect((await call(app, "GET", "/api/v1/me")).status).toBe(401);
    const res = await call(app, "GET", "/api/v1/me", { "X-Devi-Dev-User": "nadie@dev" });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "unknown_login", login: "nadie@dev" });
  });

  test("permiso de la ruta", async () => {
    const app = make();
    const res = await call(app, "GET", "/api/v1/settings", { "X-Devi-Dev-User": "maria@dev" });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "missing_perm", perm: "team.admin" });
    expect((await call(app, "GET", "/api/v1/settings", { "X-Devi-Dev-User": "admin@dev" })).status).toBe(200);
  });

  test("handler recibe access y principal", async () => {
    const res = await call(make(), "GET", "/api/v1/me", { "X-Devi-Dev-User": "maria@dev" });
    expect(await res.json()).toEqual({ memberId: "m-maria", login: "maria@dev" });
  });

  test("HttpError → su código; ZodError → 400; ruta desconocida → 404", async () => {
    const app = make();
    const h = { "X-Devi-Dev-User": "maria@dev" };
    expect((await call(app, "POST", "/api/v1/requests/missing/forward", h)).status).toBe(404);
    expect((await call(app, "POST", "/api/v1/requests/q1/forward", h)).status).toBe(400);
    expect((await call(app, "GET", "/api/v1/nope", h)).status).toBe(404);
  });

  test("CORS: preflight y cabeceras para orígenes permitidos", async () => {
    const app = make();
    const pre = await app.fetch(new Request("http://127.0.0.1/api/v1/me", { method: "OPTIONS", headers: { Origin: "tauri://localhost" } }));
    expect(pre.status).toBe(204);
    expect(pre.headers.get("Access-Control-Allow-Origin")).toBe("tauri://localhost");
    const res = await call(app, "GET", "/api/v1/me", { Origin: "tauri://localhost", "X-Devi-Dev-User": "maria@dev" });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("tauri://localhost");
    const evil = await call(app, "GET", "/api/v1/me", { Origin: "https://evil.example", "X-Devi-Dev-User": "maria@dev" });
    expect(evil.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  test("los módulos ven ctx.config", () => {
    const config = testConfig({ adminLogin: "root@dev" });
    let seen: unknown;
    const m: DeviModule = { name: "cfg", migrations: [], routes: (_r, ctx) => void (seen = ctx.config) };
    createApp({ identity: new DevIdentity(), modules: [m], allowedOrigins: [], config });
    expect(seen).toBe(config);
    expect(make().ctx.config.port).toBe(0);
  });

  test("aplica las migraciones de los módulos al arrancar", async () => {
    const app = make();
    await app.start();
    expect(app.ctx.db.query("SELECT name FROM sqlite_master WHERE name = 'test_t'").get()).toEqual({ name: "test_t" });
  });
});
