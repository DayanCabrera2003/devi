import { API, matchPath, type ErrorBody } from "@devi/protocol";

// Error con código HTTP que el núcleo convierte en respuesta JSON ({ error, ...extra }).
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public extra: Omit<ErrorBody, "error"> = {},
  ) {
    super(message);
  }
}

export const json = (data: unknown, status = 200) => Response.json(data, { status });

export const errorResponse = (e: HttpError) => json({ error: e.message, ...e.extra }, e.status);

export const TAURI_ORIGINS = ["tauri://localhost", "http://tauri.localhost", "https://tauri.localhost"];

export const isAllowedOrigin = (origin: string | null, allowed: string[]) => !!origin && allowed.includes(origin);

export function corsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Devi-Version, X-Devi-Dev-User",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

// Las únicas rutas que usa EventSource, que no admite cabeceras: ahí (y solo ahí) se aceptan
// la versión por ?v= y la identidad de desarrollo por ?devUser=. En el resto una página web
// ajena podría lanzar POST "simples" (sin preflight) con la query puesta.
export const isSseRoute = (method: string, pathname: string) =>
  method === "GET" && (!!matchPath(API.userEvents.path, pathname) || !!matchPath(API.sessionEvents.path, pathname));
