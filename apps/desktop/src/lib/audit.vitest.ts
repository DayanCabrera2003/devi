import { describe, expect, test } from "vitest";
import { actionLabel, auditNotice, describeTarget, formatDetails, parseAuditAlert, parseAuditPage } from "./audit";

const ENTRY = {
  id: "a1", at: 1_700_000_000_000, actorMemberId: "m1", actorLogin: "dayan@x",
  action: "member.updated", targetType: "member", targetId: "m2", details: { perms: "team.admin" },
};

describe("audit", () => {
  test("parseAuditAlert acepta { type: audit.alert, entry } y descarta lo demás", () => {
    expect(parseAuditAlert({ type: "audit.alert", entry: ENTRY })).toEqual(ENTRY);
    expect(parseAuditAlert({ type: "audit.alert", entry: { ...ENTRY, at: "ayer" } })).toBeNull();
    expect(parseAuditAlert({ type: "audit.alert" })).toBeNull();
    expect(parseAuditAlert({ type: "team.updated" })).toBeNull();
    expect(parseAuditAlert(null)).toBeNull();
    expect(parseAuditAlert("audit.alert")).toBeNull();
  });

  test("parseAuditPage valida la respuesta del servidor", () => {
    expect(parseAuditPage({ entries: [ENTRY], nextBefore: 5 })).toEqual({ entries: [ENTRY], nextBefore: 5 });
    expect(parseAuditPage({ entries: [ENTRY] })).toEqual({ entries: [ENTRY] });
    expect(() => parseAuditPage({ entries: "x" })).toThrow(/inesperada/);
  });

  test("acciones con etiqueta en español; las desconocidas se muestran tal cual", () => {
    expect(actionLabel("member.updated")).toBe("Persona modificada");
    expect(actionLabel("settings.updated")).toBe("Ajustes del servidor cambiados");
    expect(actionLabel("algo.nuevo")).toBe("algo.nuevo");
  });

  test("destino y detalles como texto", () => {
    expect(describeTarget(ENTRY, (id) => (id === "m2" ? "María" : id))).toBe("Persona: María");
    expect(describeTarget({ targetType: "settings" }, (id) => id)).toBe("settings");
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
