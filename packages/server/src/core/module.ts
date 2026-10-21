import type { Database } from "bun:sqlite";
import type { AccessResolver } from "./auth";
import type { Bus } from "./bus";
import type { Timers } from "./clock";
import type { ServerConfig } from "./config";
import type { Migration } from "./db";
import type { Presence } from "./presence";
import type { RateLimiter } from "./ratelimit";
import type { Router } from "./router";
import type { ServiceRegistry } from "./services";
import type { SseHub } from "./sse";

// Todo lo que un módulo puede usar del núcleo.
export interface ModuleContext {
  db: Database;
  config: ServerConfig;
  bus: Bus;
  sse: SseHub;
  now: () => number;
  log: (...a: unknown[]) => void;
  timers: Timers; // programar con esto (no con setTimeout) para que los tests usen FakeClock
  presence: Presence; // SSE abiertos + latidos → quién está conectado
  services: ServiceRegistry; // servicios que los módulos se ofrecen entre sí
  rateLimit: RateLimiter; // límites de ritmo por persona (el núcleo ya aplica draft y mutation)
  // Solo el módulo team lo llama: decide quién es miembro y con qué permisos.
  setAccessResolver(resolver: AccessResolver): void;
}

// Una feature = un módulo. Para añadir una, crea el módulo y regístralo en main.ts.
export interface DeviModule {
  name: string;
  migrations: Migration[];
  routes(router: Router, ctx: ModuleContext): void;
  onStart?(ctx: ModuleContext): void | Promise<void>; // p. ej. reprogramar temporizadores
}
