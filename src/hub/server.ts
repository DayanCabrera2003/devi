import { join } from "node:path";
import type { SessionDelivery } from "../shared/types";
import { isOpen, openStream, send } from "./sse";
import { DeviState } from "./state";
import { loadTeam } from "./team";

const ROOT = join(import.meta.dir, "../..");
const PORT = Number(process.env.DEVI_PORT ?? 4747);

const team = await loadTeam(process.env.DEVI_TEAM ?? join(ROOT, "team.json"));
const state = new DeviState();

const json = (data: unknown, status = 200) => Response.json(data, { status });
const fail = (status: number, error: string) => json({ error }, status);
const isMember = (id: string) => team.some((m) => m.id === id);

// Conectado = tiene la ventana de Devi abierta o al menos una sesión de Claude Code con Devi.
const isConnected = (user: string) => isOpen(`user:${user}`) || state.sessionsOf(user).length > 0;

function deliverToSession(sessionId: string, delivery: SessionDelivery): boolean {
  return send(`session:${sessionId}`, "deliver", delivery);
}

const server = Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  idleTimeout: 0, // no cerrar streams SSE inactivos
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;
    let m: RegExpMatchArray | null;

    if (method === "GET" && path === "/api/teammates") {
      const exclude = url.searchParams.get("exclude");
      return json(team.filter((t) => t.id !== exclude && isConnected(t.id)));
    }

    if (method === "POST" && path === "/api/sessions") {
      const { user, name } = (await req.json()) as { user?: string; name?: string };
      if (!user || !name) return fail(400, "user y name son obligatorios");
      if (!isMember(user)) return fail(404, `"${user}" no está en team.json`);
      const session = state.addSession(user, name);
      console.log(`[hub] sesión registrada ${user}/${name} (${session.id})`);
      return json({ sessionId: session.id });
    }

    if (method === "GET" && (m = path.match(/^\/api\/sessions\/([^/]+)\/events$/))) {
      const id = m[1]!;
      const session = state.sessions.get(id);
      if (!session) return fail(404, "sesión desconocida");
      return openStream(`session:${id}`, req.signal, {
        onClose: () => {
          state.removeSession(id);
          console.log(`[hub] sesión cerrada ${session.user}/${session.name}`);
        },
      });
    }

    if (method === "POST" && path === "/api/sessions/status") {
      const { user, name, status } = (await req.json()) as Record<string, string>;
      if (status !== "idle" && status !== "working") return fail(400, "status inválido");
      const s = state.setStatus(user!, name!, status);
      return s ? json(s) : fail(404, "sesión desconocida");
    }

    if (method === "GET" && (m = path.match(/^\/api\/users\/([^/]+)\/sessions$/))) {
      return json(state.sessionsOf(m[1]!));
    }

    // Solo para pruebas: empuja un mensaje a las sesiones de un usuario (o a una concreta).
    if (method === "POST" && path === "/api/debug/push") {
      const { user, sessionId, content } = (await req.json()) as Record<string, string>;
      const targets = sessionId ? [sessionId] : state.sessionsOf(user ?? "").map((s) => s.id);
      const delivered = targets.filter((id) =>
        deliverToSession(id, { kind: "debug", content: content ?? "hola desde Devi", meta: {} }),
      );
      return json({ delivered: delivered.length });
    }

    return fail(404, "not found");
  },
});

console.log(`[hub] Devi Hub en http://localhost:${server.port} · equipo: ${team.map((t) => t.id).join(", ")}`);
