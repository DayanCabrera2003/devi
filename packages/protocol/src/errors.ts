import { z } from "zod";

// Cuerpo de toda respuesta de error del servidor.
export const ErrorBodySchema = z.object({
  error: z.string(), // mensaje legible en español
  code: z.string().optional(), // p. ej. "unknown_login", "missing_perm", "version", "human_only"
  login: z.string().optional(), // con unknown_login: el login detectado
  perm: z.string().optional(), // con missing_perm
  minVersion: z.string().optional(), // con version (426): la versión actual del servidor (la mayor debe coincidir)
});
export type ErrorBody = z.infer<typeof ErrorBodySchema>;
