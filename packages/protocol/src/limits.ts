// Límites y tiempos por defecto (los tiempos son configurables en la pestaña Servidor).
export const FILE_LIMITS = { maxBytes: 1_048_576, maxFiles: 5 } as const;

export const DEFAULT_SETTINGS = {
  requestTimeoutMs: 3_600_000, // 1 h sin respuesta → timeout
  draftTtlMs: 900_000, // 15 min para autorizar un borrador
  fileRetentionDays: 7, // tras cerrar la solicitud o descartar el borrador
  fileMaxAgeDays: 30, // tope absoluto desde la subida
} as const;

// Presencia. Un SSE abierto no basta: si el cliente se cae sin cerrar la conexión, Bun.serve puede
// tardar en abortar el stream. Los clientes mandan POST /presence/heartbeat cada heartbeatMs; sin
// latido en staleMs cuentan como desconectados. El servidor revisa la presencia cada sweepMs.
export const PRESENCE = { heartbeatMs: 20_000, staleMs: 60_000, sweepMs: 15_000 } as const;
