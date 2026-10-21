import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createApp } from "./core/app";
import { DevIdentity, TailscaleServeIdentity } from "./core/auth";
import { parseServerArgs, type ServerConfig } from "./core/config";
import { openDb } from "./core/db";
import { TAURI_ORIGINS } from "./core/http";
import type { DeviModule } from "./core/module";
import { filesModule } from "./modules/files/index";
import { requestsModule } from "./modules/requests/index";
import { sessionsModule } from "./modules/sessions/index";
import { settingsModule } from "./modules/settings/index";
import { teamModule } from "./modules/team/index";

// Módulos de features, en orden de arranque. team va primero: si no hay admin, el servidor no arranca
// antes de que nada programe temporizadores.
export const MODULES: DeviModule[] = [teamModule, settingsModule, sessionsModule, filesModule, requestsModule];

// Tope del cuerpo HTTP: 5 archivos de 1 MB + multipart, con margen.
const MAX_BODY = 8 * 1024 * 1024;

export async function startServer(cfg: ServerConfig, modules: DeviModule[] = MODULES) {
  mkdirSync(cfg.dataDir, { recursive: true });
  const app = createApp({
    identity: cfg.dev ? new DevIdentity() : new TailscaleServeIdentity(),
    modules,
    config: cfg,
    allowedOrigins: cfg.dev ? [...TAURI_ORIGINS, "http://localhost:1420"] : TAURI_ORIGINS,
    db: openDb(join(cfg.dataDir, "devi.db")),
  });
  await app.start();
  const server = Bun.serve({
    port: cfg.port,
    hostname: cfg.host,
    idleTimeout: 0,
    maxRequestBodySize: MAX_BODY,
    fetch: app.fetch,
  });
  if (cfg.dev) console.warn("[devi] ⚠ MODO DEV: identidad por cabecera X-Devi-Dev-User. No usar en la red del equipo.");
  console.log(`[devi] servidor en http://${cfg.host}:${server.port} · datos en ${cfg.dataDir}`);
  return { server, app };
}

if (import.meta.main) {
  try {
    await startServer(parseServerArgs(process.argv.slice(2), { platform: process.platform, env: process.env, home: homedir() }));
  } catch (e) {
    console.error(`[devi] ${(e as Error).message}`);
    process.exit(1);
  }
}
