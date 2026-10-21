import type { Database } from "bun:sqlite";
import { API, API_VERSION, VERSION_HEADER, VERSION_QUERY, isCompatible } from "@devi/protocol";
import { ZodError } from "zod";
import type { AccessResolver, IdentityProvider } from "./auth";
import { Bus } from "./bus";
import { testConfig, type ServerConfig } from "./config";
import { migrate, openDb } from "./db";
import { HttpError, corsHeaders, errorResponse, isAllowedOrigin, isSseRoute, json } from "./http";
import type { DeviModule, ModuleContext } from "./module";
import { Router } from "./router";
import { SseHub } from "./sse";

export type AppOptions = {
  identity: IdentityProvider;
  modules: DeviModule[];
  allowedOrigins: string[];
  config?: ServerConfig; // por defecto testConfig(): startServer pasa la real
  db?: Database;
  now?: () => number;
  log?: (...a: unknown[]) => void;
};

export function createApp(opts: AppOptions) {
  let resolveAccess: AccessResolver = () => null;
  const ctx: ModuleContext = {
    db: opts.db ?? openDb(),
    config: opts.config ?? testConfig(),
    bus: new Bus(),
    sse: new SseHub(),
    now: opts.now ?? Date.now,
    log: opts.log ?? ((...a) => console.log("[devi]", ...a)),
    setAccessResolver: (r) => {
      resolveAccess = r;
    },
  };

  const router = new Router();
  for (const m of opts.modules) migrate(ctx.db, m.name, m.migrations);
  for (const m of opts.modules) m.routes(router, ctx);

  async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    // Anti-CSRF: un navegador siempre manda Origin en peticiones entre sitios. La CLI y el MCP
    // (Bun) no lo mandan y siguen permitidos.
    const origin = req.headers.get("Origin");
    if (origin !== null && !isAllowedOrigin(origin, opts.allowedOrigins)) {
      throw new HttpError(403, "Origen no permitido", { code: "origin" });
    }
    if (req.method === "GET" && url.pathname === API.health.path) return json({ ok: true, version: API_VERSION });

    // La versión por ?v= solo vale en los SSE (EventSource no admite cabeceras).
    const version = req.headers.get(VERSION_HEADER) ?? (isSseRoute(req.method, url.pathname) ? url.searchParams.get(VERSION_QUERY) : null);
    if (!isCompatible(version)) {
      throw new HttpError(426, "Actualiza Devi: tu versión no es compatible con el servidor", {
        code: "version",
        minVersion: API_VERSION,
      });
    }

    const principal = opts.identity.identify(req);
    if (!principal) throw new HttpError(401, "No se pudo identificar quién llama (¿estás en la tailnet?)", { code: "no_identity" });

    const access = resolveAccess(principal.login);
    if (!access) {
      throw new HttpError(403, `Pide al admin de Devi que te añada al equipo (tu login: ${principal.login})`, {
        code: "unknown_login",
        login: principal.login,
      });
    }

    const match = router.match(req.method, url.pathname);
    if (!match) throw new HttpError(404, "Ruta no encontrada", { code: "not_found" });
    if (match.route.perm && !access.perms.has(match.route.perm)) {
      throw new HttpError(403, `Te falta el permiso "${match.route.perm}"`, { code: "missing_perm", perm: match.route.perm });
    }
    return match.handler({ request: req, url, params: match.params, principal, access });
  }

  async function fetch(req: Request): Promise<Response> {
    const origin = req.headers.get("Origin");
    const cors = isAllowedOrigin(origin, opts.allowedOrigins) ? corsHeaders(origin!, { dev: ctx.config.dev }) : null;
    if (req.method === "OPTIONS") return new Response(null, { status: cors ? 204 : 403, headers: cors ?? {} });

    let res: Response;
    try {
      res = await handle(req);
    } catch (e) {
      if (e instanceof HttpError) res = errorResponse(e);
      else if (e instanceof ZodError) res = errorResponse(new HttpError(400, e.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message)).join("; "), { code: "invalid" }));
      else {
        ctx.log("error interno", e);
        res = errorResponse(new HttpError(500, "Error interno del servidor de Devi", { code: "internal" }));
      }
    }
    if (cors) {
      try {
        for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
      } catch {
        // Cabeceras inmutables (p. ej. Response.redirect): se reenvuelve y se ponen en la copia.
        res = new Response(res.body, res);
        for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
      }
    }
    return res;
  }

  async function start() {
    for (const m of opts.modules) await m.onStart?.(ctx);
  }

  return { fetch, start, ctx };
}
