import { describe, expect, test } from "bun:test";
import { API } from "@devi/protocol";
import { Router } from "./router";

describe("Router", () => {
  test("encuentra la ruta del catálogo y sus parámetros", () => {
    const r = new Router();
    const h = () => new Response("ok");
    r.on(API.forwardRequest, h);
    const m = r.match("POST", "/api/v1/requests/q1/forward");
    expect(m?.params).toEqual({ id: "q1" });
    expect(m?.route).toBe(API.forwardRequest);
    expect(m?.handler).toBe(h);
  });

  test("distingue método y ruta", () => {
    const r = new Router();
    r.on(API.forwardRequest, () => new Response());
    expect(r.match("GET", "/api/v1/requests/q1/forward")).toBeNull();
    expect(r.match("POST", "/api/v1/requests/q1/accept")).toBeNull();
  });

  test("no permite registrar dos veces la misma ruta", () => {
    const r = new Router();
    r.on(API.me, () => new Response());
    expect(() => r.on(API.me, () => new Response())).toThrow();
  });
});
