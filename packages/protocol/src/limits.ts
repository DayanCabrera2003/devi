// Límites y tiempos por defecto (los tiempos son configurables en la pestaña Servidor).
export const FILE_LIMITS = { maxBytes: 1_048_576, maxFiles: 5 } as const;

export const DEFAULT_SETTINGS = {
  requestTimeoutMs: 3_600_000, // 1 h sin respuesta → timeout
  draftTtlMs: 900_000, // 15 min para autorizar un borrador
  fileRetentionDays: 7, // tras cerrar la solicitud o descartar el borrador
  fileMaxAgeDays: 30, // tope absoluto desde la subida
  allowedDomains: [] as string[], // vacío = cualquier login de la tailnet (luego se mira el equipo)
  chatApproval: true, // los envíos aprobados en el aviso de Claude Code salen sin pasar por la app
} as const;

// Presencia. Un SSE abierto no basta: si el cliente se cae sin cerrar la conexión, Bun.serve puede
// tardar en abortar el stream. Los clientes mandan POST /presence/heartbeat cada heartbeatMs; sin
// latido en staleMs cuentan como desconectados. El servidor revisa la presencia cada sweepMs.
export const PRESENCE = { heartbeatMs: 20_000, staleMs: 60_000, sweepMs: 15_000 } as const;

// Contexto opcional de una solicitud (lo que se intentó, el error, la urgencia y lo que el MCP saca de git).
// diffStatLines: el MCP recorta `git diff --stat` a estas líneas; el diff completo solo va como archivo adjunto.
export const CONTEXT_LIMITS = {
  textChars: 2_000, // summary y tried
  errorChars: 4_000,
  branchChars: 200,
  commitChars: 300,
  diffStatLines: 50,
  diffStatChars: 6_000,
} as const;
