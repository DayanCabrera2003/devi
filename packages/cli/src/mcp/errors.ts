import { DeviApiError } from "@devi/client";

// Convierte cualquier error en un texto que Claude pueda explicar al usuario.
// DeviApiError ya trae el mensaje legible (401, 403 login/permiso/origen, 426, sin conexión…).
export function readableError(e: unknown): string {
  if (e instanceof DeviApiError && e.status === 0) return `${e.message} No se puede enviar nada hasta que vuelva.`;
  return e instanceof Error ? e.message : String(e);
}
