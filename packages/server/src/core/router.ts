import { matchPath, type API } from "@devi/protocol";
import type { Access, Principal } from "./auth";

export type RouteDef = (typeof API)[keyof typeof API];

// Lo que recibe cada handler. `access` siempre existe: el núcleo ya rechazó a quien no es del equipo.
export type RequestContext = {
  request: Request;
  url: URL;
  params: Record<string, string>;
  principal: Principal;
  access: Access;
};

export type Handler = (ctx: RequestContext) => Response | Promise<Response>;

type Entry = { route: RouteDef; handler: Handler };

// Router mínimo: solo acepta rutas del catálogo de @devi/protocol, así el contrato manda.
export class Router {
  private entries: Entry[] = [];

  on(route: RouteDef, handler: Handler): void {
    if (this.entries.some((e) => e.route.method === route.method && e.route.path === route.path)) {
      throw new Error(`ruta duplicada: ${route.method} ${route.path}`);
    }
    this.entries.push({ route, handler });
  }

  match(method: string, path: string): (Entry & { params: Record<string, string> }) | null {
    for (const e of this.entries) {
      if (e.route.method !== method) continue;
      const params = matchPath(e.route.path, path);
      if (params) return { ...e, params };
    }
    return null;
  }
}
