import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createApp } from "./core/app";
import { DevIdentity, TailscaleServeIdentity } from "./core/auth";
import { parseServerArgs, type ServerConfig } from "./core/config";
import { openDb } from "./core/db";
import { TAURI_ORIGINS } from "./core/http";
import type { DeviModule } from "./core/module";

// Los módulos de features se añaden aquí (Fase 1: team, sessions, requests, files).
export const MODULES: DeviModule[] = [];

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
  const server = Bun.serve({ port: cfg.port, hostname: cfg.host, idleTimeout: 0, fetch: app.fetch });
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
