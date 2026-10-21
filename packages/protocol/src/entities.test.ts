import { describe, expect, test } from "bun:test";
import { DeviRequestSchema, DraftSchema, MemberSchema, RoleSchema } from "./entities";
import { PERMS, type Perm } from "./perms";
import { FILE_LIMITS } from "./limits";

describe("entidades", () => {
  test("Role solo admite permisos conocidos", () => {
    const ok = { id: "r1", name: "Backend", color: "#4a7bd8", capabilities: ["Aprobar PRs backend"], perms: ["requests.send"] as Perm[] };
    expect(RoleSchema.parse(ok)).toEqual(ok);
    expect(() => RoleSchema.parse({ ...ok, perms: ["root"] })).toThrow();
  });

  test("Member exige login no vacío", () => {
    const m = { id: "m1", login: "maria@example.com", name: "María", description: "", roleIds: [], disabled: false };
    expect(MemberSchema.parse(m)).toEqual(m);
    expect(() => MemberSchema.parse({ ...m, login: "" })).toThrow();
  });

  test("Draft de respuesta lleva requestId; de solicitud, toMemberId", () => {
    const base = {
      id: "d1", authorMemberId: "m1", authorSessionId: "s1", message: "hola",
      status: "awaiting", files: [], createdAt: 1, expiresAt: 2,
    };
    expect(DraftSchema.parse({ ...base, kind: "request", toMemberId: "m2" }).kind).toBe("request");
    expect(DraftSchema.parse({ ...base, kind: "response", requestId: "q1" }).kind).toBe("response");
    expect(() => DraftSchema.parse({ ...base, kind: "request" })).toThrow();
    expect(() => DraftSchema.parse({ ...base, kind: "response" })).toThrow();
  });

  test("DeviRequest con archivos", () => {
    const r = DeviRequestSchema.parse({
      id: "q1", fromMemberId: "m1", fromSessionId: "s1", fromSessionName: "frontend", toMemberId: "m2",
      message: "¿me apruebas el PR?", status: "pending",
      files: [{ id: "f1", name: "log.txt", size: 10, direction: "request" }], responseFiles: [],
      createdAt: 1, sentAt: 1, deadline: 2,
    });
    expect(r.files[0]?.name).toBe("log.txt");
  });

  test("constantes", () => {
    expect(PERMS).toEqual(["requests.send", "files.send", "team.admin"]);
    expect(FILE_LIMITS).toEqual({ maxBytes: 1_048_576, maxFiles: 5 });
  });
});

describe("dominios permitidos", () => {
  test("SettingsSchema normaliza y valida allowedDomains", async () => {
    const { SettingsSchema, DEFAULT_SETTINGS } = await import("./index");
    expect(DEFAULT_SETTINGS.allowedDomains).toEqual([]);
    const s = SettingsSchema.parse({ ...DEFAULT_SETTINGS, allowedDomains: [" ASAI.digital "] });
    expect(s.allowedDomains).toEqual(["asai.digital"]);
    for (const bad of ["", "@asai.digital", "asai", "a b.com", "-x.com"]) {
      expect(SettingsSchema.safeParse({ ...DEFAULT_SETTINGS, allowedDomains: [bad] }).success).toBe(false);
    }
  });

  test("loginInDomains: sin dominios, todo vale; si no, @dominio exacto sin distinguir mayúsculas", async () => {
    const { loginInDomains } = await import("./index");
    expect(loginInDomains("x@y.com", [])).toBe(true);
    expect(loginInDomains("Dayan@ASAI.digital", ["asai.digital"])).toBe(true);
    expect(loginInDomains("x@evil-asai.digital", ["asai.digital"])).toBe(false);
    expect(loginInDomains("x@sub.asai.digital", ["asai.digital"])).toBe(false);
    expect(loginInDomains("asai.digital", ["asai.digital"])).toBe(false);
    expect(loginInDomains("x@asai.digital.evil.com", ["asai.digital"])).toBe(false);
  });
});
