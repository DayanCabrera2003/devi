// Registro de auditoría (Admin → Auditoría). El servidor lo expone en API.audit (solo admin) y avisa de los
// cambios de seguridad con el evento de usuario `audit.alert`. Los tipos vienen de @devi/protocol y
// @devi/client ya valida cada entrada: aquí solo se traduce a texto para la UI (nunca HTML).
import type { AuditAction, AuditEntry, AuditTarget } from "@devi/protocol";
import type { Notice } from "./notify";
import { truncate } from "./format";

export type { AuditEntry, AuditPage } from "@devi/protocol";

// Una etiqueta por cada acción de AUDIT_ACTIONS: si el protocolo añade una, TypeScript obliga a ponerle texto.
const ACTION_LABELS: Record<AuditAction, string> = {
  "draft.created": "Borrador creado",
  "draft.authorized": "Borrador autorizado",
  "draft.approved_in_chat": "Envío aprobado en el chat",
  "draft.discarded": "Borrador descartado",
  "draft.expired": "Borrador caducado",
  "request.sent_from_app": "Solicitud enviada desde la app",
  "request.forwarded": "Solicitud enviada a una sesión",
  "request.accepted": "Solicitud aceptada",
  "request.rejected": "Solicitud rechazada",
  "request.answered": "Solicitud respondida",
  "request.resent": "Solicitud reenviada",
  "request.ignored": "Solicitud ignorada",
  "request.timed_out": "Solicitud sin respuesta a tiempo",
  "request.escalated": "Aviso de solicitud sin respuesta (escalado)",
  "request.reassigned": "Solicitud pedida a otra persona",
  "request.taken_in_chat": "Solicitud traída a una sesión desde Claude Code",
  "request.declined_in_chat": "Solicitud rechazada desde Claude Code",
  "response.accepted": "Respuesta aceptada",
  "response.forwarded": "Respuesta enviada a una sesión",
  "file.downloaded": "Archivo descargado",
  "member.created": "Persona añadida",
  "member.updated": "Persona modificada",
  "member.disabled": "Persona desactivada",
  "member.deleted": "Persona eliminada",
  "role.created": "Rol creado",
  "role.updated": "Rol modificado",
  "role.deleted": "Rol eliminado",
  "settings.updated": "Ajustes del servidor cambiados",
  "db.exported": "Base de datos exportada",
  "login.rejected": "Acceso rechazado",
  "knowledge.shared": "Respuesta guardada en la base del equipo",
  "knowledge.withdrawn": "Respuesta retirada de la base del equipo",
  "chat.sent": "Mensaje de chat enviado",
  "chat.to_session": "Mensaje de chat enviado a una sesión",
  "chat.sent_from_session": "Mensaje de chat escrito desde Claude Code",
};

// Por si un servidor más nuevo manda una acción que esta versión aún no conoce.
export const actionLabel = (action: string): string => (ACTION_LABELS as Record<string, string>)[action] ?? action;

const TARGET_LABELS: Record<AuditTarget, string> = {
  draft: "Borrador",
  request: "Solicitud",
  file: "Archivo",
  member: "Persona",
  role: "Rol",
  settings: "Ajustes",
  db: "Base de datos",
  login: "Login",
  knowledge: "Base del equipo",
  chat: "Mensaje de chat",
};

export function describeTarget(e: Pick<AuditEntry, "targetType" | "targetId">, nameOf: (memberId: string) => string): string {
  const label = TARGET_LABELS[e.targetType];
  if (!e.targetId) return label;
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
