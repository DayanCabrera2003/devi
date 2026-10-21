import type { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { API_VERSION, type Perm } from "@devi/protocol";
import { createApp } from "../core/app";
import { TAURI_ORIGINS } from "../core/http";
import { DevIdentity } from "../core/auth";
import { FakeClock } from "../core/clock";
import { testConfig } from "../core/config";
import type { DeviModule } from "../core/module";
import type { MemberInfo } from "../core/services";

// Utilidades de test: app en modo dev, SQLite en memoria, reloj falso y un directorio de datos temporal.
// Las peticiones pasan por app.fetch (sin red). Cada test llama a cleanup() al terminar.

export type Sent = { key: string; event: string; data: any };

// db, clock y dataDir se pueden pasar para simular un reinicio del servidor sobre los mismos datos.
export function createTestApp(opts: {
  modules: DeviModule[];
  adminLogin?: string;
  importTeam?: string;
  db?: Database;
  clock?: FakeClock;
  dataDir?: string;
  dev?: boolean; // por defecto true (testConfig)
  allowedDomains?: string[]; // como --allowed-domain
}) {
  const clock = opts.clock ?? new FakeClock();
  const dataDir = opts.dataDir ?? mkdtempSync(join(tmpdir(), "devi-test-"));
  const app = createApp({
    identity: new DevIdentity(),
    modules: opts.modules,
    allowedOrigins: TAURI_ORIGINS,
    db: opts.db,
    now: clock.now,
    timers: clock,
    config: testConfig({ dataDir, adminLogin: opts.adminLogin, importTeam: opts.importTeam, dev: opts.dev ?? true, allowedDomains: opts.allowedDomains ?? [] }),
    log: () => {},
  });

  // Registra todo lo que se empuja por SSE (a usuarios y a sesiones), haya o no stream abierto.
  const sent: Sent[] = [];
  const send = app.ctx.sse.send.bind(app.ctx.sse);
  app.ctx.sse.send = (key, event, data) => {
    sent.push({ key, event, data });
    return send(key, event, data);
  };

  const headers = (login: string) => ({ "X-Devi-Version": API_VERSION, "X-Devi-Dev-User": login });

  // Por defecto se llama como la app (Origin tauri://localhost), que puede usar todas las rutas.
  // origin: null simula la CLI/MCP o un agente, que no mandan Origin.
  async function call(login: string, method: string, path: string, body?: unknown, opts: { origin?: string | null } = {}) {
    const origin = opts.origin === undefined ? "tauri://localhost" : opts.origin;
    const base: Record<string, string> = origin ? { ...headers(login), Origin: origin } : headers(login);
    const init: RequestInit = { method, headers: base };
    if (body instanceof FormData) init.body = body;
    else if (body !== undefined) {
      init.body = JSON.stringify(body);
      init.headers = { ...base, "Content-Type": "application/json" };
    }
    const res = await app.fetch(new Request(`http://127.0.0.1${path}`, init));
    const text = await res.text();
    let data: any = text;
    try {
      data = JSON.parse(text);
    } catch {
      // no era JSON (descargas): se deja el texto
    }
    return { status: res.status, data, headers: res.headers };
  }

  // Abre un SSE (usuario o sesión) y devuelve cómo cerrarlo. No lee el stream: lo enviado queda en `sent`.
  async function openStream(login: string, path: string) {
    const ac = new AbortController();
    const res = await app.fetch(new Request(`http://127.0.0.1${path}`, { headers: headers(login), signal: ac.signal }));
    return { status: res.status, close: () => ac.abort() };
  }

  const userEvents = (memberId: string) => sent.filter((s) => s.key === `user:${memberId}`).map((s) => s.data);
  const deliveries = (sessionId: string) => sent.filter((s) => s.key === `session:${sessionId}`).map((s) => s.data);

  function cleanup() {
    app.stop();
    rmSync(dataDir, { recursive: true, force: true });
  }

  return { app, clock, dataDir, call, openStream, sent, userEvents, deliveries, cleanup };
}

// Módulo team mínimo para probar otros módulos sin el real: logins fijos con sus permisos.
export function stubTeamModule(members: (MemberInfo & { perms: Perm[] })[]): DeviModule {
  return {
    name: "stub-team",
    migrations: [],
    routes(_r, ctx) {
      ctx.setAccessResolver((login) => {
        const m = members.find((x) => x.login === login && !x.disabled);
        return m ? { memberId: m.id, perms: new Set(m.perms) } : null;
      });
      ctx.services.provide("team", {
        member: (id) => members.find((m) => m.id === id) ?? null,
        nameOf: (id) => members.find((m) => m.id === id)?.name ?? id,
        memberIds: () => members.map((m) => m.id),
        adminIds: () => members.filter((m) => !m.disabled && m.perms.includes("team.admin")).map((m) => m.id),
      });
    },
  };
}

export const ALL_PERMS: Perm[] = ["requests.send", "files.send", "team.admin"];
