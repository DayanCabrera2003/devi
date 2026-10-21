import { describe, expect, test } from "vitest";
import { AUDIT_ACTIONS, type AuditEntry } from "@devi/protocol";
import { actionLabel, auditNotice, describeTarget, formatDetails } from "./audit";

const ENTRY: AuditEntry = {
  id: 1, at: 1_700_000_000_000, actorMemberId: "m1", actorLogin: "dayan@x",
  action: "member.updated", targetType: "member", targetId: "m2", details: { perms: "team.admin" },
};

describe("audit", () => {
  test("acciones con etiqueta en español; las desconocidas se muestran tal cual", () => {
    expect(actionLabel("member.updated")).toBe("Persona modificada");
    expect(actionLabel("settings.updated")).toBe("Ajustes del servidor cambiados");
    expect(actionLabel("login.rejected")).toBe("Acceso rechazado");
    expect(actionLabel("algo.nuevo")).toBe("algo.nuevo");
  });

  test("todas las acciones del protocolo tienen etiqueta propia", () => {
    for (const a of AUDIT_ACTIONS) expect(actionLabel(a)).not.toBe(a);
  });

  test("destino y detalles como texto", () => {
    expect(describeTarget(ENTRY, (id) => (id === "m2" ? "María" : id))).toBe("Persona: María");
    expect(describeTarget({ targetType: "settings" }, (id) => id)).toBe("Ajustes");
    expect(describeTarget({ targetType: "login", targetId: "x@y" }, (id) => id)).toBe("Login: x@y");
    expect(formatDetails({ perms: "team.admin", antes: "no" })).toBe("perms: team.admin · antes: no");
    expect(formatDetails({})).toBe("");
  });

  test("aviso nativo de un cambio de seguridad", () => {
    const n = auditNotice(ENTRY, (id) => (id === "m2" ? "María" : id));
    expect(n.title).toBe("Devi · Cambio de seguridad: Persona modificada");
    expect(n.body).toContain("dayan@x");
    expect(n.body).toContain("María");
  });
});
