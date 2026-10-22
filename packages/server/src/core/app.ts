import type { Database } from "bun:sqlite";
import { API, API_VERSION, PRESENCE, VERSION_HEADER, VERSION_QUERY, isCompatible, loginInDomains } from "@devi/protocol";
import { ZodError } from "zod";
import type { AccessResolver, IdentityProvider } from "./auth";
import { Bus } from "./bus";
import { RealTimers, type Timers } from "./clock";
import { testConfig, type ServerConfig } from "./config";
import { migrate, openDb } from "./db";
import { HttpError, corsHeaders, errorResponse, isAllowedOrigin, isSseRoute, json, securityHeaders, withHeaders } from "./http";
import type { DeviModule, ModuleContext } from "./module";
import { Presence } from "./presence";
import { RateLimiter, type RateLimits } from "./ratelimit";
import { Router } from "./router";
import { ServiceRegistry } from "./services";
import { SseHub } from "./sse";

export type AppOptions = {
  identity: IdentityProvider;
  modules: DeviModule[];
  allowedOrigins: string[];
  config?: ServerConfig; // por defecto testConfig(): startServer pasa la real
  db?: Database;
  now?: () => number;
  log?: (...a: unknown[]) => void;
  timers?: Timers; // por defecto RealTimers; los tests pasan un FakeClock
  rateLimits?: Partial<RateLimits>; // por defecto DEFAULT_RATE_LIMITS
};

export function createApp(opts: AppOptions) {
  let resolveAccess: AccessResolver = () => null;
  const bus = new Bus();
  const sse = new SseHub();
  const now = opts.now ?? Date.now;
  const ctx: ModuleContext = {
    db: opts.db ?? openDb(),
    config: opts.config ?? testConfig(),
    bus,
    sse,
    now,
    log: opts.log ?? ((...a) => console.log("[devi]", ...a)),
    timers: opts.timers ?? new RealTimers(),
    presence: new Presence(sse, bus, now),
    services: new ServiceRegistry(),
    rateLimit: new RateLimiter(now, opts.rateLimits),
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
    // (Bun) no lo mandan y siguen permitidos, salvo en las rutas humanas (ver más abajo).
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

    // Dominios permitidos (ajuste allowedDomains): se comprueba antes de mirar el equipo.
    const domains = ctx.services.find("settings")?.get().allowedDomains ?? [];
    if (!loginInDomains(principal.login, domains)) {
      ctx.services.find("audit")?.loginRejected(principal.login, "domain");
      throw new HttpError(403, `Tu login (${principal.login}) no es de un dominio permitido en este servidor de Devi`, {
        code: "domain",
        login: principal.login,
      });
    }

    const access = resolveAccess(principal.login);
    if (!access) {
      ctx.services.find("audit")?.loginRejected(principal.login, "unknown_login");
      throw new HttpError(403, `Pide al admin de Devi que te añada al equipo (tu login: ${principal.login})`, {
        code: "unknown_login",
        login: principal.login,
      });
    }

    const match = router.match(req.method, url.pathname);
    if (!match) throw new HttpError(404, "Ruta no encontrada", { code: "not_found" });
    // Acciones humanas (autorizar, responder, administrar): solo con el Origin de la app. Si llega
    // Origin ya se comprobó arriba que es permitido; aquí se exige que exista. Es una barrera contra
    // un agente que llame a la API directamente, no contra un proceso local que falsifique cabeceras.
    if ("human" in match.route && match.route.human && origin === null) {
      throw new HttpError(403, "Esta acción solo se puede hacer desde la app de Devi", { code: "human_only" });
    }
    if (match.route.perm && !access.perms.has(match.route.perm)) {
      throw new HttpError(403, `Te falta el permiso "${match.route.perm}"`, { code: "missing_perm", perm: match.route.perm });
    }
    // Límites de ritmo por persona: borradores aparte; el latido de presencia no cuenta; las lecturas tampoco.
    // Enviar desde la app cuenta como un borrador: es la otra forma de crear una solicitud.
    if (match.route === API.createDraft || match.route === API.sendFromApp) ctx.rateLimit.take("draft", access.memberId);
    else if (req.method !== "GET" && match.route !== API.heartbeat) ctx.rateLimit.take("mutation", access.memberId);
    return match.handler({ request: req, url, params: match.params, principal, access });
  }

  async function fetch(req: Request): Promise<Response> {
    const origin = req.headers.get("Origin");
    const cors = isAllowedOrigin(origin, opts.allowedOrigins) ? corsHeaders(origin!, { dev: ctx.config.dev }) : null;
    const pathname = new URL(req.url).pathname;
    if (req.method === "OPTIONS") {
      return withHeaders(new Response(null, { status: cors ? 204 : 403 }), { ...(cors ?? {}), ...securityHeaders(pathname, null) });
    }

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
    return withHeaders(res, { ...(cors ?? {}), ...securityHeaders(pathname, res.headers.get("Content-Type")) });
  }

  async function start() {
    for (const m of opts.modules) await m.onStart?.(ctx);
    ctx.timers.every(PRESENCE.sweepMs, () => ctx.presence.sweep());
  }

  // Cancela todos los temporizadores (tareas periódicas, plazos). Lo usan los tests y el apagado.
  function stop() {
    ctx.timers.stopAll();
  }

  return { fetch, start, stop, ctx };
}
