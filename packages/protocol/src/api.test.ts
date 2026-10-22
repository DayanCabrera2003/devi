import { describe, expect, test } from "bun:test";
import { API, CreateRoleBody, InboxQuery, RegisterSessionBody, UpdateMemberBody, UpdateRoleBody, buildPath, matchPath } from "./api";

describe("catálogo de la API", () => {
  test("todas las rutas cuelgan de /api/v1 y no se repiten", () => {
    const seen = new Set<string>();
    for (const r of Object.values(API)) {
      expect(r.path.startsWith("/api/v1/")).toBe(true);
      const key = `${r.method} ${r.path}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  test("las acciones humanas y las mutaciones de equipo/ajustes van marcadas como human", () => {
    const human = Object.entries(API).filter(([, r]) => "human" in r && r.human).map(([k]) => k).sort();
    expect(human).toEqual([
      "acceptRequest", "acceptResponse", "authorizeDraft", "createMember", "createRole", "deleteMember", "deleteRole",
      "discardDraft", "exportDb", "forwardRequest", "forwardResponse", "ignoreRequest", "rejectRequest", "resendRequest",
      "sendFromApp",
      "updateMember", "updateRole", "updateSettings",
    ]);
  });

  test("buildPath sustituye parámetros y codifica", () => {
    expect(buildPath(API.forwardRequest.path, { id: "a b" })).toBe("/api/v1/requests/a%20b/forward");
    expect(() => buildPath(API.forwardRequest.path, {})).toThrow();
  });

  test("matchPath extrae parámetros", () => {
    expect(matchPath("/api/v1/requests/:id/forward", "/api/v1/requests/q1/forward")).toEqual({ id: "q1" });
    expect(matchPath("/api/v1/requests/:id/forward", "/api/v1/requests/q1/accept")).toBeNull();
  });

  test("los PATCH no inventan valores por defecto", () => {
    expect(UpdateMemberBody.parse({ name: "x" })).toEqual({ name: "x" });
    expect(UpdateRoleBody.parse({ name: "y" })).toEqual({ name: "y" });
    expect(CreateRoleBody.parse({ name: "y" })).toEqual({ name: "y", color: "#4a7bd8", capabilities: [], perms: [] });
  });

  test("matchPath con escapes inválidos no rompe", () => {
    expect(matchPath("/api/v1/files/:id", "/api/v1/files/%E0%A4%A")).toBeNull();
  });

  test("bandeja de sesión: no es humana (la usan los hooks y el MCP) y registrar sesión lleva channel", () => {
    expect(API.sessionInbox).toMatchObject({ method: "GET", path: "/api/v1/sessions/inbox", actor: "owner" });
    expect(API.ackInbox).toMatchObject({ method: "POST", path: "/api/v1/sessions/inbox/ack", actor: "owner" });
    expect("human" in API.sessionInbox).toBe(false);
    expect("human" in API.ackInbox).toBe(false);
    expect(InboxQuery.parse({ parentPid: "12", claudeSessionId: "c1" })).toEqual({ parentPid: 12, claudeSessionId: "c1", machine: "" });
    expect(InboxQuery.parse({ parentPid: "12", claudeSessionId: "c1", machine: "M1" }).machine).toBe("M1");
    expect(API.ackInbox.body.safeParse({ ids: ["a"] }).success).toBe(true);
    expect(API.ackInbox.body.safeParse({}).success).toBe(false);
    expect(RegisterSessionBody.parse({ name: "a", cwd: "/", parentPid: 1 }).channel).toBe(false);
    expect(RegisterSessionBody.parse({ name: "a", cwd: "/", parentPid: 1, channel: true }).channel).toBe(true);
  });

  test("identidad de la sesión: máquina, instancia del MCP y claudeSessionId (opcionales, compatibles con MCP antiguos)", () => {
    expect(RegisterSessionBody.parse({ name: "a", cwd: "/", parentPid: 1 })).toEqual({ name: "a", cwd: "/", parentPid: 1, channel: false, machine: "" });
    const full = { name: "a", cwd: "/", parentPid: 1, channel: true, machine: "M1", instanceId: "i1", claudeSessionId: "cs" };
    expect(RegisterSessionBody.parse(full)).toEqual(full);
    expect(RegisterSessionBody.safeParse({ ...full, instanceId: "" }).success).toBe(false);
    expect(API.sessionHook.body.parse({ claudeSessionId: "c", cwd: "/", parentPid: 1, status: "idle" }).machine).toBe("");
  });

  test("los cuerpos validan", () => {
    expect(API.rejectRequest.body.safeParse({ reason: "" }).success).toBe(false);
    expect(API.rejectRequest.body.safeParse({ reason: "no tengo permisos" }).success).toBe(true);
    expect(API.forwardRequest.body.safeParse({ sessionId: "s1" }).success).toBe(true);
  });
});

describe("auditoría", () => {
  test("GET /audit es de admin, no humana, y pagina con limit/before", async () => {
    const { AuditQuery, AUDIT_ACTIONS } = await import("./audit");
    expect(API.audit).toMatchObject({ method: "GET", path: "/api/v1/audit", perm: "team.admin", actor: "admin" });
    expect("human" in API.audit).toBe(false);
    expect(AuditQuery.parse({})).toEqual({ limit: 50 });
    expect(AuditQuery.parse({ limit: "10", before: "99" })).toEqual({ limit: 10, before: 99 });
    expect(AuditQuery.safeParse({ limit: "500" }).success).toBe(false);
    expect(AUDIT_ACTIONS).toContain("login.rejected");
  });
});

describe("aprobación en el chat", () => {
  test("CreateDraftMeta: approval app|chat, por defecto app", async () => {
    const { CreateDraftMeta } = await import("./api");
    const req = { kind: "request", sessionId: "s1", to: "m2", message: "hola" };
    expect(CreateDraftMeta.parse(req)).toMatchObject({ approval: "app" });
    expect(CreateDraftMeta.parse({ ...req, approval: "chat" })).toMatchObject({ approval: "chat" });
    expect(CreateDraftMeta.parse({ kind: "response", sessionId: "s1", requestId: "q1", message: "ok", approval: "chat" })).toMatchObject({ approval: "chat" });
    expect(CreateDraftMeta.safeParse({ ...req, approval: "auto" }).success).toBe(false);
  });

  test("createDraft no es humana y su respuesta dice por dónde se aprobó", () => {
    expect("human" in API.createDraft).toBe(false);
    const draft = {
      id: "d1", kind: "request", toMemberId: "m2", authorMemberId: "m1", authorSessionId: "s1", message: "hola",
      status: "authorized", files: [], createdAt: 1, expiresAt: 2,
    };
    const chat = API.createDraft.response.parse({ ...draft, approval: "chat", sent: { requestId: "q1", toName: "María", sentAt: 1, deadline: 9 } });
    expect(chat).toMatchObject({ approval: "chat", sent: { requestId: "q1", toName: "María", deadline: 9 } });
    const app = API.createDraft.response.parse({ ...draft, status: "awaiting", approval: "app" });
    expect(app.sent).toBeUndefined();
    expect(API.createDraft.response.safeParse(draft).success).toBe(false); // approval es obligatorio
  });

  test("la acción de auditoría draft.approved_in_chat existe", async () => {
    const { AUDIT_ACTIONS } = await import("./audit");
    expect(AUDIT_ACTIONS).toContain("draft.approved_in_chat");
  });

  test("ajuste chatApproval: booleano, activado por defecto", async () => {
    const { SettingsSchema } = await import("./entities");
    const { DEFAULT_SETTINGS } = await import("./limits");
    expect(DEFAULT_SETTINGS.chatApproval).toBe(true);
    expect(SettingsSchema.parse(DEFAULT_SETTINGS).chatApproval).toBe(true);
    expect(SettingsSchema.safeParse({ ...DEFAULT_SETTINGS, chatApproval: "sí" }).success).toBe(false);
    expect(SettingsSchema.safeParse({ ...DEFAULT_SETTINGS, chatApproval: undefined }).success).toBe(false);
  });
});
