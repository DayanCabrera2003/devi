import { describe, expect, test } from "vitest";
import { ConnectionStore, fromClient, fromError, statusLabel } from "./connection.svelte";

const fatal = (status: number, body: Record<string, string>) => ({ status, body: { error: "x", ...body } });

describe("conexión", () => {
  test("estados del cliente", () => {
    expect(fromClient("open")).toEqual({ status: "connected" });
    expect(fromClient("reconnecting")).toEqual({ status: "reconnecting" });
    expect(fromClient("failed", fatal(403, { code: "unknown_login", login: "a@b" }))).toEqual({ status: "unknown_login", login: "a@b" });
    expect(fromClient("failed", fatal(426, { minVersion: "2.0.0" }))).toEqual({ status: "update_required", minVersion: "2.0.0" });
    expect(fromClient("failed", fatal(403, { code: "origin" })).status).toBe("blocked");
    expect(fromClient("failed", fatal(401, {})).status).toBe("blocked");
  });

  test("failed nunca es reconnecting: missing_perm bloquea con un mensaje legible", () => {
    const s = fromClient("failed", fatal(403, { code: "missing_perm", perm: "requests.send" }));
    expect(s.status).toBe("blocked");
    expect(s.status === "blocked" && s.message).toContain("permiso");
  });

  test("failed con 401 bloquea", () => {
    expect(fromClient("failed", fatal(401, { code: "no_identity" })).status).toBe("blocked");
  });

  test("failed con cualquier otro 403 bloquea con el texto del servidor", () => {
    expect(fromClient("failed", fatal(403, { code: "forbidden", error: "Estás desactivado" }))).toEqual({
      status: "blocked",
      message: "Estás desactivado",
    });
  });

  test("failed con code version va a la pantalla de actualizar", () => {
    expect(fromClient("failed", fatal(426, { code: "version", minVersion: "3.0.0" }))).toEqual({
      status: "update_required",
      minVersion: "3.0.0",
    });
  });

  test("failed sin un error reconocible tampoco es reconnecting", () => {
    expect(fromClient("failed").status).toBe("blocked");
    expect(fromClient("failed", new Error("raro")).status).toBe("blocked");
  });

  test("un 403 missing_perm al conectar bloquea", () => {
    expect(fromError(fatal(403, { code: "missing_perm", perm: "requests.send" })).status).toBe("blocked");
  });

  test("un error de red reconecta", () => {
    expect(fromError(new TypeError("Failed to fetch"))).toEqual({ status: "reconnecting" });
  });

  test("etiquetas", () => {
    expect(statusLabel({ status: "connected" })).toBe("conectado");
    expect(statusLabel({ status: "reconnecting" })).toContain("reconectando");
  });

  test("store", () => {
    const c = new ConnectionStore();
    expect(c.online).toBe(false);
    c.fromClient("open");
    expect(c.online).toBe(true);
    expect(c.blocked).toBe(false);
    c.fail(fatal(403, { code: "unknown_login", login: "a@b" }));
    expect(c.online).toBe(false);
    expect(c.blocked).toBe(true);
  });
});
