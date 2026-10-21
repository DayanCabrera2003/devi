import { z } from "zod";
import {
  DeviRequestSchema, DraftSchema, MeSchema, MemberSchema, PermSchema, RoleSchema,
  SessionSchema, SessionStatusSchema, SettingsSchema, TeamViewSchema,
} from "./entities";
import type { Perm } from "./perms";

// Quién puede llamar una ruta además del permiso (lo comprueba el módulo, no el núcleo):
// any = cualquier miembro; admin = team.admin; author = autor del borrador;
// recipient = destinatario de la solicitud; sender = remitente; owner = dueño de la sesión;
// party = remitente o destinatario.
export type Actor = "any" | "admin" | "author" | "recipient" | "sender" | "owner" | "party";

type Route = {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: `/api/v1/${string}`;
  perm: Perm | null;
  actor: Actor;
  body: z.ZodType;
  response: z.ZodType;
};
const route = <R extends Route>(r: R) => r;

const Empty = z.object({}).strict();
const Ok = z.object({ ok: z.literal(true) });
const NonEmpty = z.string().trim().min(1);

// Ojo con zod 4: .partial() conserva los .default() internos. Los Update* se construyen desde
// esquemas sin defaults; si no, un PATCH de solo el nombre borraría roles o permisos.
const MemberFields = z.object({ login: NonEmpty, name: NonEmpty, description: z.string(), roleIds: z.array(z.string()) });
export const CreateMemberBody = MemberFields.extend({
  description: z.string().default(""), roleIds: z.array(z.string()).default([]),
});
export const UpdateMemberBody = MemberFields.partial().extend({ disabled: z.boolean().optional() });
const RoleFields = z.object({ name: NonEmpty, color: z.string(), capabilities: z.array(NonEmpty), perms: z.array(PermSchema) });
export const CreateRoleBody = RoleFields.extend({
  color: z.string().default("#4a7bd8"), capabilities: z.array(NonEmpty).default([]), perms: z.array(PermSchema).default([]),
});
export const UpdateRoleBody = RoleFields.partial();

export const RegisterSessionBody = z.object({ name: NonEmpty, cwd: z.string(), parentPid: z.number().int() });
export const HookBody = z.object({
  claudeSessionId: z.string(), cwd: z.string(), parentPid: z.number().int(), status: SessionStatusSchema,
});

// POST /drafts es multipart: campo "meta" (JSON de este esquema) + 0..5 campos "files".
export const CreateDraftMeta = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("request"), sessionId: z.string(), to: z.string(), message: NonEmpty }),
  z.object({ kind: z.literal("response"), sessionId: z.string(), requestId: z.string(), message: NonEmpty }),
]);

export const API = {
  health: route({ method: "GET", path: "/api/v1/health", perm: null, actor: "any", body: Empty,
    response: z.object({ ok: z.literal(true), version: z.string() }) }),
  me: route({ method: "GET", path: "/api/v1/me", perm: null, actor: "any", body: Empty, response: MeSchema }),
  team: route({ method: "GET", path: "/api/v1/team", perm: null, actor: "any", body: Empty, response: TeamViewSchema }),

  createMember: route({ method: "POST", path: "/api/v1/team/members", perm: "team.admin", actor: "admin", body: CreateMemberBody, response: MemberSchema }),
  updateMember: route({ method: "PATCH", path: "/api/v1/team/members/:id", perm: "team.admin", actor: "admin", body: UpdateMemberBody, response: MemberSchema }),
  deleteMember: route({ method: "DELETE", path: "/api/v1/team/members/:id", perm: "team.admin", actor: "admin", body: Empty, response: Ok }),
  createRole: route({ method: "POST", path: "/api/v1/team/roles", perm: "team.admin", actor: "admin", body: CreateRoleBody, response: RoleSchema }),
  updateRole: route({ method: "PATCH", path: "/api/v1/team/roles/:id", perm: "team.admin", actor: "admin", body: UpdateRoleBody, response: RoleSchema }),
  deleteRole: route({ method: "DELETE", path: "/api/v1/team/roles/:id", perm: "team.admin", actor: "admin", body: Empty, response: Ok }),
  getSettings: route({ method: "GET", path: "/api/v1/settings", perm: "team.admin", actor: "admin", body: Empty, response: SettingsSchema }),
  updateSettings: route({ method: "PATCH", path: "/api/v1/settings", perm: "team.admin", actor: "admin", body: SettingsSchema.partial(), response: SettingsSchema }),
  exportDb: route({ method: "GET", path: "/api/v1/settings/export", perm: "team.admin", actor: "admin", body: Empty, response: z.any() /* application/octet-stream */ }),

  registerSession: route({ method: "POST", path: "/api/v1/sessions", perm: null, actor: "any", body: RegisterSessionBody, response: SessionSchema }),
  closeSession: route({ method: "DELETE", path: "/api/v1/sessions/:id", perm: null, actor: "owner", body: Empty, response: Ok }),
  sessionHook: route({ method: "POST", path: "/api/v1/sessions/hook", perm: null, actor: "any", body: HookBody, response: Ok }),
  memberSessions: route({ method: "GET", path: "/api/v1/members/:id/sessions", perm: null, actor: "any", body: Empty, response: z.array(SessionSchema) }),

  createDraft: route({ method: "POST", path: "/api/v1/drafts", perm: "requests.send", actor: "any", body: CreateDraftMeta, response: DraftSchema }),
  authorizeDraft: route({ method: "POST", path: "/api/v1/drafts/:id/authorize", perm: null, actor: "author", body: Empty, response: DraftSchema }),
  discardDraft: route({ method: "POST", path: "/api/v1/drafts/:id/discard", perm: null, actor: "author", body: Empty, response: DraftSchema }),

  forwardRequest: route({ method: "POST", path: "/api/v1/requests/:id/forward", perm: null, actor: "recipient", body: z.object({ sessionId: z.string() }), response: DeviRequestSchema }),
  acceptRequest: route({ method: "POST", path: "/api/v1/requests/:id/accept", perm: null, actor: "recipient", body: z.object({ note: z.string().optional() }), response: DeviRequestSchema }),
  rejectRequest: route({ method: "POST", path: "/api/v1/requests/:id/reject", perm: null, actor: "recipient", body: z.object({ reason: NonEmpty }), response: DeviRequestSchema }),
  acceptResponse: route({ method: "POST", path: "/api/v1/requests/:id/response/accept", perm: null, actor: "sender", body: Empty, response: DeviRequestSchema }),
  forwardResponse: route({ method: "POST", path: "/api/v1/requests/:id/response/forward", perm: null, actor: "sender", body: z.object({ sessionId: z.string() }), response: DeviRequestSchema }),
  resendRequest: route({ method: "POST", path: "/api/v1/requests/:id/resend", perm: null, actor: "sender", body: Empty, response: DeviRequestSchema }),
  ignoreRequest: route({ method: "POST", path: "/api/v1/requests/:id/ignore", perm: null, actor: "sender", body: Empty, response: DeviRequestSchema }),

  downloadFile: route({ method: "GET", path: "/api/v1/files/:id", perm: null, actor: "party", body: Empty, response: z.any() /* text/plain */ }),

  userEvents: route({ method: "GET", path: "/api/v1/events/user", perm: null, actor: "any", body: Empty, response: z.any() /* SSE */ }),
  sessionEvents: route({ method: "GET", path: "/api/v1/events/session/:id", perm: null, actor: "owner", body: Empty, response: z.any() /* SSE */ }),

  debugPush: route({ method: "POST", path: "/api/v1/debug/push", perm: "team.admin", actor: "admin",
    body: z.object({ memberId: z.string().optional(), sessionId: z.string().optional(), content: z.string().default("hola desde Devi") }),
    response: z.object({ delivered: z.number() }) }),
} as const;

export type ApiRoute = keyof typeof API;

export function buildPath(path: string, params: Record<string, string>): string {
  return path.replace(/:(\w+)/g, (_, k: string) => {
    const v = params[k];
    if (v === undefined) throw new Error(`falta el parámetro :${k} en ${path}`);
    return encodeURIComponent(v);
  });
}

export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split("/");
  const a = path.split("/");
  if (p.length !== a.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    const seg = p[i]!;
    const val = a[i]!;
    if (seg.startsWith(":")) {
      try {
        params[seg.slice(1)] = decodeURIComponent(val);
      } catch {
        return null; // escape inválido → la ruta no coincide (404), no un 500
      }
    } else if (seg !== val) return null;
  }
  return params;
}
