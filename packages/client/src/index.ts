// Cliente tipado de la API de Devi. Lo usan la CLI (`devi mcp`) y la app de escritorio.
export { createClient, type ClientOptions, type DeviClient } from "./client";
export { DeviApiError } from "./errors";
export type { SseStatus } from "./sse";
