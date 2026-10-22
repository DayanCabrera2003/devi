import { chmodSync, lstatSync, mkdirSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createApp } from "./core/app";
import { DevIdentity, TailscaleServeIdentity } from "./core/auth";
import { parseServerArgs, type ServerConfig } from "./core/config";
import { openDb } from "./core/db";
import { TAURI_ORIGINS } from "./core/http";
import type { DeviModule } from "./core/module";
import { auditModule } from "./modules/audit/index";
import { filesModule } from "./modules/files/index";
import { knowledgeModule } from "./modules/knowledge/index";
import { prefsModule } from "./modules/prefs/index";
import { requestsModule } from "./modules/requests/index";
import { sessionsModule } from "./modules/sessions/index";
import { settingsModule } from "./modules/settings/index";
import { teamModule } from "./modules/team/index";

// Módulos de features, en orden de arranque. team va primero: si no hay admin, el servidor no arranca
// antes de que nada programe temporizadores.
export const MODULES: DeviModule[] = [teamModule, settingsModule, prefsModule, auditModule, sessionsModule, filesModule, requestsModule, knowledgeModule];

// Tope del cuerpo HTTP: 5 archivos de 1 MB + multipart, con margen.
const MAX_BODY = 8 * 1024 * 1024;

// Prepara la ruta del socket: crea el directorio (0700) y borra un socket huérfano de un arranque
// anterior. Nunca borra algo que no sea un socket (una ruta mal puesta no debe destruir datos).
function prepareSocketPath(path: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  let st;
  try {
    st = lstatSync(path);
  } catch {
    return; // no existe
  }
  if (!st.isSocket()) throw new Error(`--socket ${path}: ya existe y no es un socket; no se toca`);
  unlinkSync(path);
}

function listen(cfg: ServerConfig, fetch: (req: Request) => Promise<Response>) {
  const common = { idleTimeout: 0, maxRequestBodySize: MAX_BODY, fetch };
  if (!cfg.socket) return Bun.serve({ ...common, port: cfg.port, hostname: cfg.host });
  prepareSocketPath(cfg.socket);
  // Los tipos de Bun no admiten idleTimeout con unix, pero Bun lo respeta (comprobado con 1.3): sin él,
  // corta los SSE a los 10 s sin datos. Por eso el cast.
  const server = Bun.serve({ ...common, unix: cfg.socket } as unknown as Parameters<typeof Bun.serve>[0]);
  // Solo el dueño (el usuario del servicio) y root (tailscaled) pueden conectarse.
  chmodSync(cfg.socket, 0o600);
  return server;
}

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
  let server: ReturnType<typeof listen>;
  try {
    server = listen(cfg, app.fetch);
  } catch (e) {
    app.stop();
    throw e;
  }
  if (cfg.dev) console.warn("[devi] ⚠ MODO DEV: identidad por cabecera X-Devi-Dev-User. No usar en la red del equipo.");
  const where = cfg.socket ? `unix:${cfg.socket}` : `http://${cfg.host}:${server.port}`;
  console.log(`[devi] servidor en ${where} · datos en ${cfg.dataDir}`);
  if (!cfg.socket && !cfg.dev) {
    console.warn("[devi] ⚠ escuchando en un puerto TCP: cualquier proceso de esta máquina puede falsificar la identidad. En producción usa --socket (ver deploy/servidor-linux/README.md).");
  }
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
