// Permisos de Devi. Un rol los concede; los de una persona son la unión de los de sus roles.
// Añadir un permiso = una entrada aquí + su etiqueta (la UI la usa en las casillas del rol).
export const PERMS = ["requests.send", "files.send", "team.admin"] as const;
export type Perm = (typeof PERMS)[number];

export const PERM_LABELS: Record<Perm, string> = {
  "requests.send": "Enviar solicitudes",
  "files.send": "Enviar archivos",
  "team.admin": "Administrar equipo",
};
