// Registro de auditoría (Admin → Auditoría). El servidor lo expone en GET /api/v1/audit (admin) y avisa de
// los cambios de seguridad con el evento de usuario `audit.alert`. Los tipos se validan aquí con zod para
// no depender de que @devi/protocol ya los tenga: el contenido viene de la red y se trata con cuidado.
import { z } from "zod";
import type { Notice } from "./notify";
import { truncate } from "./format";

export const AuditEntrySchema = z.object({
  id: z.string(),
  at: z.number(),
  actorMemberId: z.string().optional(),
  actorLogin: z.string(),
  action: z.string(),
  targetType: z.string(),
  targetId: z.string().optional(),
  details: z.record(z.string(), z.string()),
});
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

export const AuditPageSchema = z.object({ entries: z.array(AuditEntrySchema), nextBefore: z.number().optional() });
export type AuditPage = z.infer<typeof AuditPageSchema>;

const AuditAlertSchema = z.object({ type: z.literal("audit.alert"), entry: AuditEntrySchema });

// Evento SSE de usuario, venga como venga: devuelve la entrada solo si es un audit.alert bien formado.
export function parseAuditAlert(ev: unknown): AuditEntry | null {
  const r = AuditAlertSchema.safeParse(ev);
  return r.success ? r.data.entry : null;
}

export function parseAuditPage(data: unknown): AuditPage {
  const r = AuditPageSchema.safeParse(data);
  if (!r.success) throw new Error("Respuesta inesperada del servidor de Devi al pedir la auditoría (¿versiones distintas?)");
  return r.data;
}

const ACTION_LABELS: Record<string, string> = {
  "member.created": "Persona añadida",
  "member.updated": "Persona modificada",
  "member.disabled": "Persona desactivada",
  "member.enabled": "Persona reactivada",
  "member.deleted": "Persona eliminada",
  "member.login_added": "Login añadido",
  "member.login_removed": "Login quitado",
  "role.created": "Rol creado",
  "role.updated": "Rol modificado",
  "role.deleted": "Rol eliminado",
  "role.assigned": "Rol asignado",
  "role.unassigned": "Rol retirado",
  "perms.changed": "Permisos cambiados",
  "settings.updated": "Ajustes del servidor cambiados",
  "server.domains_updated": "Dominios permitidos cambiados",
  "db.exported": "Base de datos exportada",
  "auth.unknown_login": "Intento de acceso de un login desconocido",
  "auth.denied": "Acceso denegado",
  "auth.rate_limited": "Demasiadas peticiones (límite)",
  "admin.bootstrap": "Admin inicial creado",
  "draft.authorized": "Borrador autorizado",
  "draft.discarded": "Borrador descartado",
  "request.forwarded": "Solicitud enviada a una sesión",
  "response.forwarded": "Respuesta enviada a una sesión",
  "file.downloaded": "Archivo descargado",
};

export const actionLabel = (action: string): string => ACTION_LABELS[action] ?? action;

const TARGET_LABELS: Record<string, string> = {
  member: "Persona",
  role: "Rol",
  settings: "Ajustes",
  session: "Sesión",
  request: "Solicitud",
  draft: "Borrador",
  file: "Archivo",
};

export function describeTarget(e: Pick<AuditEntry, "targetType" | "targetId">, nameOf: (memberId: string) => string): string {
  if (!e.targetId) return e.targetType;
  const label = TARGET_LABELS[e.targetType] ?? e.targetType;
  const id = e.targetType === "member" ? nameOf(e.targetId) : e.targetId;
  return `${label}: ${id}`;
}

export const formatDetails = (d: Record<string, string>): string =>
  Object.entries(d)
    .map(([k, v]) => `${k}: ${v}`)
    .join(" · ");

export function auditNotice(e: AuditEntry, nameOf: (memberId: string) => string): Notice {
  return {
    title: `Devi · Cambio de seguridad: ${actionLabel(e.action)}`,
    body: truncate(`${e.actorLogin} → ${describeTarget(e, nameOf)}${Object.keys(e.details).length ? ` (${formatDetails(e.details)})` : ""}`),
  };
}
