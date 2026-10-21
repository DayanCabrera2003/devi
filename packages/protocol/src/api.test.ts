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
    expect(InboxQuery.parse({ parentPid: "12", claudeSessionId: "c1" })).toEqual({ parentPid: 12, claudeSessionId: "c1" });
    expect(API.ackInbox.body.safeParse({ ids: ["a"] }).success).toBe(true);
    expect(API.ackInbox.body.safeParse({}).success).toBe(false);
    expect(RegisterSessionBody.parse({ name: "a", cwd: "/", parentPid: 1 }).channel).toBe(false);
    expect(RegisterSessionBody.parse({ name: "a", cwd: "/", parentPid: 1, channel: true }).channel).toBe(true);
  });

  test("los cuerpos validan", () => {
    expect(API.rejectRequest.body.safeParse({ reason: "" }).success).toBe(false);
    expect(API.rejectRequest.body.safeParse({ reason: "no tengo permisos" }).success).toBe(true);
    expect(API.forwardRequest.body.safeParse({ sessionId: "s1" }).success).toBe(true);
  });
});
