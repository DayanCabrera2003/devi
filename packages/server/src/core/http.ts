import { API, matchPath, type ErrorBody } from "@devi/protocol";

// Error con código HTTP que el núcleo convierte en respuesta JSON ({ error, ...extra }).
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public extra: Omit<ErrorBody, "error"> = {},
    public headers: Record<string, string> = {},
  ) {
    super(message);
  }
}

export const json = (data: unknown, status = 200) => Response.json(data, { status });

export const errorResponse = (e: HttpError) => {
  const res = json({ error: e.message, ...e.extra }, e.status);
  for (const [k, v] of Object.entries(e.headers)) res.headers.set(k, v);
  return res;
};

export const TAURI_ORIGINS = ["tauri://localhost", "http://tauri.localhost", "https://tauri.localhost"];

export const isAllowedOrigin = (origin: string | null, allowed: string[]) => !!origin && allowed.includes(origin);

// X-Devi-Dev-User solo se anuncia en dev: en producción el preflight no debe invitar a usarla.
export function corsHeaders(origin: string, opts: { dev: boolean }): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": `Content-Type, X-Devi-Version${opts.dev ? ", X-Devi-Dev-User" : ""}`,
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

// Las únicas rutas que usa EventSource, que no admite cabeceras: ahí (y solo ahí) se aceptan
// la versión por ?v= y la identidad de desarrollo por ?devUser=. En el resto una página web
// ajena podría lanzar POST "simples" (sin preflight) con la query puesta.
export const isSseRoute = (method: string, pathname: string) =>
  method === "GET" && (!!matchPath(API.userEvents.path, pathname) || !!matchPath(API.sessionEvents.path, pathname));
