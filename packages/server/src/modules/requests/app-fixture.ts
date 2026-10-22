import { PRESENCE } from "@devi/protocol";
import type { RateLimits } from "../../core/ratelimit";
import { createTestApp, stubTeamModule } from "../../testing/harness";
import { auditModule } from "../audit/index";
import { filesModule } from "../files/index";
import { sessionsModule } from "../sessions/index";
import { settingsModule } from "../settings/index";
import { requestsModule } from "./index";

// Escenario de envío desde la app y conversaciones: Dayan, María y Leo (sin files.send) como en fixture.ts,
// más Ana (sin requests.send) y Pablo (desactivado).
export const appMembers: Parameters<typeof stubTeamModule>[0] = [
  { id: "m-dayan", login: "dayan@dev", name: "Dayan", disabled: false, perms: ["requests.send", "files.send", "team.admin"] },
  { id: "m-maria", login: "maria@dev", name: "María", disabled: false, perms: ["requests.send", "files.send"] },
  { id: "m-leo", login: "leo@dev", name: "Leo", disabled: false, perms: ["requests.send"] },
  { id: "m-ana", login: "ana@dev", name: "Ana", disabled: false, perms: [] },
  { id: "m-pablo", login: "pablo@dev", name: "Pablo", disabled: true, perms: ["requests.send"] },
];

export type AppFlow = Awaited<ReturnType<typeof setupAppFlow>>;

export async function setupAppFlow(opts: { rateLimits?: Partial<RateLimits> } = {}) {
  const t = createTestApp({
    modules: [stubTeamModule(appMembers), settingsModule, sessionsModule, filesModule, requestsModule, auditModule],
    rateLimits: opts.rateLimits,
  });
  await t.app.start();

  async function session(login: string, name: string, parentPid: number) {
    const s = (await t.call(login, "POST", "/api/v1/sessions", { name, cwd: `/repo/${name}`, parentPid })).data;
    await t.openStream(login, `/api/v1/events/session/${s.id}`);
    t.clock.every(PRESENCE.heartbeatMs, () => t.app.ctx.presence.touch(`session:${s.id}`));
    return { id: s.id as string };
  }

  function form(meta: unknown, files: File[] = []) {
    const f = new FormData();
    f.set("meta", typeof meta === "string" ? meta : JSON.stringify(meta));
    for (const file of files) f.append("files", file);
    return f;
  }

  // Envío desde la app (con el Origin de la app, salvo que se pida otro).
  const send = (login: string, meta: unknown, files: File[] = [], o: { origin?: string | null } = {}) =>
    t.call(login, "POST", "/api/v1/requests", form(meta, files), o);

  const audit = async () => [...(await t.call("dayan@dev", "GET", "/api/v1/audit?limit=200")).data.entries].reverse();

  return { ...t, session, form, send, audit };
}

export const txt = (name: string, content: string) => new File([content], name);
