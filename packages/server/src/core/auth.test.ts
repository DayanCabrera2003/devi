import { describe, expect, test } from "bun:test";
import { DevIdentity, TailscaleServeIdentity } from "./auth";

const req = (headers: Record<string, string> = {}, url = "http://127.0.0.1:4747/api/v1/me") =>
  new Request(url, { headers });

describe("TailscaleServeIdentity", () => {
  const id = new TailscaleServeIdentity();
  test("lee las cabeceras que añade tailscale serve", () => {
    expect(id.identify(req({ "Tailscale-User-Login": "maria@example.com", "Tailscale-User-Name": "María" }))).toEqual({
      login: "maria@example.com",
      displayName: "María",
    });
  });
  test("sin cabecera → null (dispositivos con tag o acceso directo)", () => {
    expect(id.identify(req())).toBeNull();
  });
  test("si falta el nombre usa el login", () => {
    expect(id.identify(req({ "Tailscale-User-Login": "leo@example.com" }))?.displayName).toBe("leo@example.com");
  });
});

describe("DevIdentity", () => {
  const id = new DevIdentity();
  test("cabecera X-Devi-Dev-User", () => {
    expect(id.identify(req({ "X-Devi-Dev-User": "dayan@dev" }))?.login).toBe("dayan@dev");
  });
  test("query devUser (EventSource no admite cabeceras)", () => {
    expect(id.identify(req({}, "http://127.0.0.1:4747/api/v1/events/user?devUser=leo@dev"))?.login).toBe("leo@dev");
  });
  test("query devUser solo en las rutas SSE", () => {
    expect(id.identify(req({}, "http://127.0.0.1:4747/api/v1/me?devUser=leo@dev"))).toBeNull();
    expect(id.identify(req({}, "http://127.0.0.1:4747/api/v1/events/session/s1?devUser=leo@dev"))?.login).toBe("leo@dev");
  });
  test("sin nada → null", () => {
    expect(id.identify(req())).toBeNull();
  });
});
