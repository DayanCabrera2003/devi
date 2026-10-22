import { z } from "zod";
import {
  DeviRequestSchema, DraftSchema, InboxItemSchema, MeSchema, MemberSchema, PermSchema, RoleSchema,
  SessionSchema, SessionStatusSchema, SettingsSchema, TeamViewSchema,
} from "./entities";
import type { Perm } from "./perms";
import { AuditPageSchema } from "./audit";
import { RequestContextSchema } from "./context";
import { ConversationPageSchema, ConversationsResponseSchema, SendFromAppMeta } from "./conversations";
import { PendingSchema } from "./pending";

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
  // Acción humana: solo desde la app de Devi. El núcleo exige un Origin permitido (el de la app);
  // la CLI/MCP no lo mandan, así un agente no puede autorizar, responder ni administrar por su cuenta.
  human?: true;
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

// Identidad de una sesión (ver "Identidad y sesiones" en docs/arquitectura.md). La persona sale siempre del
// login de Tailscale; estos campos solo distinguen entre las sesiones de esa misma persona:
// - parentPid: pid de Claude Code (el MCP y los hooks son hijos directos suyos);
// - machine: id estable de la máquina (un pid solo es único dentro de una máquina);
// - instanceId: id aleatorio de cada proceso `devi mcp`, estable mientras vive (reconexiones idempotentes);
// - claudeSessionId: session_id de Claude Code si el MCP lo conoce (CLAUDE_CODE_SESSION_ID).
// name es el nombre que se pide (la carpeta); el servidor lo hace único por persona: "api", "api (2)"…
// channel: la sesión tiene el canal de Claude Code cargado (recibe las entregas en tiempo real).
// Sin canal, las entregas esperan en la bandeja de la sesión hasta que un hook las recoge.
const Machine = z.string().max(200).default("");
export const RegisterSessionBody = z.object({
  name: NonEmpty, cwd: z.string(), parentPid: z.number().int(), channel: z.boolean().default(false),
  machine: Machine, instanceId: z.string().min(1).max(200).optional(), claudeSessionId: z.string().min(1).max(200).optional(),
});
export const HookBody = z.object({
  claudeSessionId: z.string(), cwd: z.string(), parentPid: z.number().int(), status: SessionStatusSchema, machine: Machine,
});

// GET /sessions/inbox va con query: el hook se identifica igual que en POST /sessions/hook.
export const InboxQuery = z.object({ parentPid: z.coerce.number().int(), claudeSessionId: z.string(), machine: Machine });
export const AckInboxBody = z.object({ ids: z.array(z.string()).max(200) });

// POST /drafts es multipart: campo "meta" (JSON de este esquema) + 0..5 campos "files".
// approval: dónde lo aprueba el humano. "app" = queda en borrador hasta que lo autoriza en la app de Devi.
// "chat" = ya lo aprobó en el aviso de permisos de Claude Code (la herramienta del MCP lo exige en cada
// llamada); si el equipo tiene activado chatApproval, el servidor lo envía al crearlo.
export const ApprovalSchema = z.enum(["app", "chat"]);
export type Approval = z.infer<typeof ApprovalSchema>;
export const CreateDraftMeta = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("request"), sessionId: z.string(), to: z.string(), message: NonEmpty, approval: ApprovalSchema.default("app"),
    context: RequestContextSchema.optional(),
  }),
  z.object({ kind: z.literal("response"), sessionId: z.string(), requestId: z.string(), message: NonEmpty, approval: ApprovalSchema.default("app") }),
]);

// Respuesta de POST /drafts. approval = cómo se aprobó de verdad: "app" si quedó esperando en la app
// (también cuando se pidió "chat" con chatApproval desactivado). sent solo existe si ya se envió.
export const CreateDraftResult = z.intersection(
  DraftSchema,
  z.object({
    approval: ApprovalSchema,
    sent: z
      .object({
        requestId: z.string(),
        toName: z.string(), // a quién le llegó: el destinatario o, en una respuesta, quien pidió
        sentAt: z.number(),
        deadline: z.number().optional(), // solo solicitudes: plazo para que respondan
      })
      .optional(),
  }),
);
export type CreateDraftResult = z.infer<typeof CreateDraftResult>;

export const API = {
  health: route({ method: "GET", path: "/api/v1/health", perm: null, actor: "any", body: Empty,
    response: z.object({ ok: z.literal(true), version: z.string() }) }),
  me: route({ method: "GET", path: "/api/v1/me", perm: null, actor: "any", body: Empty, response: MeSchema }),
  team: route({ method: "GET", path: "/api/v1/team", perm: null, actor: "any", body: Empty, response: TeamViewSchema }),

  createMember: route({ human: true, method: "POST", path: "/api/v1/team/members", perm: "team.admin", actor: "admin", body: CreateMemberBody, response: MemberSchema }),
  updateMember: route({ human: true, method: "PATCH", path: "/api/v1/team/members/:id", perm: "team.admin", actor: "admin", body: UpdateMemberBody, response: MemberSchema }),
  deleteMember: route({ human: true, method: "DELETE", path: "/api/v1/team/members/:id", perm: "team.admin", actor: "admin", body: Empty, response: Ok }),
  createRole: route({ human: true, method: "POST", path: "/api/v1/team/roles", perm: "team.admin", actor: "admin", body: CreateRoleBody, response: RoleSchema }),
  updateRole: route({ human: true, method: "PATCH", path: "/api/v1/team/roles/:id", perm: "team.admin", actor: "admin", body: UpdateRoleBody, response: RoleSchema }),
  deleteRole: route({ human: true, method: "DELETE", path: "/api/v1/team/roles/:id", perm: "team.admin", actor: "admin", body: Empty, response: Ok }),
  getSettings: route({ method: "GET", path: "/api/v1/settings", perm: "team.admin", actor: "admin", body: Empty, response: SettingsSchema }),
  updateSettings: route({ human: true, method: "PATCH", path: "/api/v1/settings", perm: "team.admin", actor: "admin", body: SettingsSchema.partial(), response: SettingsSchema }),
  // Registro de auditoría (query: AuditQuery). Solo lectura: ninguna ruta lo cambia.
  audit: route({ method: "GET", path: "/api/v1/audit", perm: "team.admin", actor: "admin", body: Empty /* query: AuditQuery */, response: AuditPageSchema }),
  exportDb: route({ human: true, method: "GET", path: "/api/v1/settings/export", perm: "team.admin", actor: "admin", body: Empty, response: z.any() /* application/octet-stream */ }),

  registerSession: route({ method: "POST", path: "/api/v1/sessions", perm: null, actor: "any", body: RegisterSessionBody, response: SessionSchema }),
  closeSession: route({ method: "DELETE", path: "/api/v1/sessions/:id", perm: null, actor: "owner", body: Empty, response: Ok }),
  sessionHook: route({ method: "POST", path: "/api/v1/sessions/hook", perm: null, actor: "any", body: HookBody, response: Ok }),
  // Bandeja de la sesión (entregas sin canal). No son humanas: las usan los hooks y el MCP.
  sessionInbox: route({ method: "GET", path: "/api/v1/sessions/inbox", perm: null, actor: "owner", body: Empty /* query: InboxQuery */,
    response: z.array(InboxItemSchema) }),
  ackInbox: route({ method: "POST", path: "/api/v1/sessions/inbox/ack", perm: null, actor: "owner", body: AckInboxBody, response: Ok }),
  memberSessions: route({ method: "GET", path: "/api/v1/members/:id/sessions", perm: null, actor: "any", body: Empty, response: z.array(SessionSchema) }),
  // Latido de presencia: la app lo manda sin sessionId; el MCP, con el de su sesión. Ver PRESENCE.
  heartbeat: route({ method: "POST", path: "/api/v1/presence/heartbeat", perm: null, actor: "any",
    body: z.object({ sessionId: z.string().optional() }), response: Ok }),

  createDraft: route({ method: "POST", path: "/api/v1/drafts", perm: "requests.send", actor: "any", body: CreateDraftMeta, response: CreateDraftResult }),
  authorizeDraft: route({ human: true, method: "POST", path: "/api/v1/drafts/:id/authorize", perm: null, actor: "author", body: Empty, response: DraftSchema }),
  discardDraft: route({ human: true, method: "POST", path: "/api/v1/drafts/:id/discard", perm: null, actor: "author", body: Empty, response: DraftSchema }),

  forwardRequest: route({ human: true, method: "POST", path: "/api/v1/requests/:id/forward", perm: null, actor: "recipient", body: z.object({ sessionId: z.string() }), response: DeviRequestSchema }),
  acceptRequest: route({ human: true, method: "POST", path: "/api/v1/requests/:id/accept", perm: null, actor: "recipient", body: z.object({ note: z.string().optional() }), response: DeviRequestSchema }),
  rejectRequest: route({ human: true, method: "POST", path: "/api/v1/requests/:id/reject", perm: null, actor: "recipient", body: z.object({ reason: NonEmpty }), response: DeviRequestSchema }),
  acceptResponse: route({ human: true, method: "POST", path: "/api/v1/requests/:id/response/accept", perm: null, actor: "sender", body: Empty, response: DeviRequestSchema }),
  forwardResponse: route({ human: true, method: "POST", path: "/api/v1/requests/:id/response/forward", perm: null, actor: "sender", body: z.object({ sessionId: z.string() }), response: DeviRequestSchema }),
  resendRequest: route({ human: true, method: "POST", path: "/api/v1/requests/:id/resend", perm: null, actor: "sender", body: Empty, response: DeviRequestSchema }),
  ignoreRequest: route({ human: true, method: "POST", path: "/api/v1/requests/:id/ignore", perm: null, actor: "sender", body: Empty, response: DeviRequestSchema }),

  // Enviar desde la app (multipart: "meta" = SendFromAppMeta + 0..5 "files"; con archivos pide además files.send).
  // La escribe una persona: sale directamente como pending, sin borrador.
  sendFromApp: route({ human: true, method: "POST", path: "/api/v1/requests", perm: "requests.send", actor: "any", body: SendFromAppMeta, response: DeviRequestSchema }),
  // Conversaciones por persona: solo las solicitudes entre quien llama y :memberId (query: ConversationQuery).
  conversations: route({ method: "GET", path: "/api/v1/conversations", perm: null, actor: "any", body: Empty, response: ConversationsResponseSchema }),
  conversation: route({ method: "GET", path: "/api/v1/conversations/:memberId", perm: null, actor: "party", body: Empty /* query: ConversationQuery */, response: ConversationPageSchema }),

  // Lecturas para el agente (herramientas del MCP): lo que me espera y una solicitud en la que soy parte.
  pending: route({ method: "GET", path: "/api/v1/pending", perm: null, actor: "any", body: Empty, response: PendingSchema }),
  getRequest: route({ method: "GET", path: "/api/v1/requests/:id", perm: null, actor: "party", body: Empty, response: DeviRequestSchema }),

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
