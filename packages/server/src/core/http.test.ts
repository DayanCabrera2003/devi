import { describe, expect, test } from "bun:test";
import { HttpError, corsHeaders, errorResponse, isAllowedOrigin } from "./http";

describe("http", () => {
  test("errorResponse incluye el mensaje y los extras", async () => {
    const res = errorResponse(new HttpError(403, "no eres del equipo", { code: "unknown_login", login: "x@y" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "no eres del equipo", code: "unknown_login", login: "x@y" });
  });

  test("orígenes de Tauri permitidos; otros no", () => {
    const allowed = ["tauri://localhost", "http://tauri.localhost", "https://tauri.localhost"];
    expect(isAllowedOrigin("tauri://localhost", allowed)).toBe(true);
    expect(isAllowedOrigin("https://evil.example", allowed)).toBe(false);
    expect(isAllowedOrigin(null, allowed)).toBe(false);
  });

  test("corsHeaders refleja el origen permitido", () => {
    const h = corsHeaders("tauri://localhost");
    expect(h["Access-Control-Allow-Origin"]).toBe("tauri://localhost");
    expect(h["Access-Control-Allow-Headers"]).toContain("X-Devi-Version");
    expect(h["Vary"]).toBe("Origin");
  });
});
