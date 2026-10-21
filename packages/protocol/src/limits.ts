// Límites y tiempos por defecto (los tiempos son configurables en la pestaña Servidor).
export const FILE_LIMITS = { maxBytes: 1_048_576, maxFiles: 5 } as const;

export const DEFAULT_SETTINGS = {
  requestTimeoutMs: 3_600_000, // 1 h sin respuesta → timeout
  draftTtlMs: 900_000, // 15 min para autorizar un borrador
  fileRetentionDays: 7, // tras cerrar la solicitud o descartar el borrador
  fileMaxAgeDays: 30, // tope absoluto desde la subida
} as const;
