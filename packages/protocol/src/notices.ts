import { z } from "zod";

// Preferencias de cada persona (no del equipo): las cambia ella misma en Ajustes de la app.
// sessionNotices: al llegarle una solicitud, además de la tarjeta en la app, se avisa en su sesión de Claude Code
// viva más reciente (kind="request_notice"), para que pueda atenderla desde allí (p. ej. con Remote Control).
export const MemberPrefsSchema = z.object({
  sessionNotices: z.boolean(),
});
export type MemberPrefs = z.infer<typeof MemberPrefsSchema>;

export const DEFAULT_MEMBER_PREFS: MemberPrefs = { sessionNotices: true };

// El aviso lleva solo un resumen del mensaje: la solicitud entera llega al traerla a la sesión (take_request).
export const NOTICE_LIMITS = { summaryChars: 280 } as const;
