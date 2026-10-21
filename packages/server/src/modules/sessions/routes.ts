import { API } from "@devi/protocol";
import { readBody } from "../../core/body";
import { json } from "../../core/http";
import type { ModuleContext } from "../../core/module";
import { sessionKey } from "../../core/push";
import type { Router } from "../../core/router";
import type { SessionManager } from "./service";

const ok = () => json({ ok: true });

export function registerSessionRoutes(r: Router, ctx: ModuleContext, sessions: SessionManager): void {
  r.on(API.registerSession, async ({ request, access }) =>
    json(sessions.register(access.memberId, await readBody(request, API.registerSession.body))),
  );

  r.on(API.closeSession, ({ params, access }) => {
    sessions.close(access.memberId, params.id!);
    return ok();
  });

  r.on(API.sessionHook, async ({ request, access }) => {
    sessions.hook(access.memberId, await readBody(request, API.sessionHook.body));
    return ok();
  });

  // Selector de sesiones: solo las vivas.
  r.on(API.memberSessions, ({ params }) => json(sessions.liveOf(params.id!)));

  r.on(API.heartbeat, async ({ request, access }) => {
    const { sessionId } = await readBody(request, API.heartbeat.body);
    sessions.heartbeat(access.memberId, sessionId);
    return ok();
  });

  // SSE del MCP: mientras está abierto (y con latidos), la sesión está viva.
  r.on(API.sessionEvents, ({ request, params, access }) => {
    const s = sessions.owned(access.memberId, params.id!);
    return ctx.presence.open(sessionKey(s.id), request.signal, { onOpen: () => sessions.opened(s.id) });
  });
}
