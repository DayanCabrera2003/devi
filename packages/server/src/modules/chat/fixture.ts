import { PRESENCE } from "@devi/protocol";
import { createTestApp, stubTeamModule } from "../../testing/harness";
import { auditModule } from "../audit/index";
import { filesModule } from "../files/index";
import { requestsModule } from "../requests/index";
import { sessionsModule } from "../sessions/index";
import { settingsModule } from "../settings/index";
import { chatModule } from "./index";

// Dayan, María y Leo (sin files.send), Ana (sin requests.send) y Pablo (desactivado), como en requests/app-fixture.ts.
const members: Parameters<typeof stubTeamModule>[0] = [
  { id: "m-dayan", login: "dayan@dev", name: "Dayan", disabled: false, perms: ["requests.send", "files.send", "team.admin"] },
  { id: "m-maria", login: "maria@dev", name: "María", disabled: false, perms: ["requests.send", "files.send"] },
  { id: "m-leo", login: "leo@dev", name: "Leo", disabled: false, perms: ["requests.send"] },
  { id: "m-ana", login: "ana@dev", name: "Ana", disabled: false, perms: [] },
  { id: "m-pablo", login: "pablo@dev", name: "Pablo", disabled: true, perms: ["requests.send"] },
];

export type ChatFlow = Awaited<ReturnType<typeof setupChat>>;

export async function setupChat() {
  const t = createTestApp({
    modules: [stubTeamModule(members), settingsModule, sessionsModule, filesModule, requestsModule, chatModule, auditModule],
  });
  await t.app.start();

  // Sesión viva (SSE abierto y latidos). features: lo que declara entender su MCP (por defecto, también el chat).
  async function session(login: string, name: string, parentPid: number, features: string[] = ["chat"]) {
    const s = (await t.call(login, "POST", "/api/v1/sessions", { name, cwd: `/repo/${name}`, parentPid, features })).data;
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

  // Mensaje escrito en la app (con el Origin de la app, salvo que se pida otro).
  const send = (login: string, meta: unknown, files: File[] = [], o: { origin?: string | null } = {}) =>
    t.call(login, "POST", "/api/v1/chat", form(meta, files), o);

  // Mensaje escrito por Claude desde una sesión (sin Origin, como el MCP).
  const fromSession = (login: string, meta: unknown, files: File[] = []) =>
    t.call(login, "POST", "/api/v1/chat/from-session", form(meta, files), { origin: null });

  const toSession = (login: string, id: string, sessionId: string, o: { origin?: string | null } = {}) =>
    t.call(login, "POST", `/api/v1/chat/${id}/session`, { sessionId }, o);

  const page = (login: string, memberId: string, query = "") => t.call(login, "GET", `/api/v1/chat/${memberId}${query}`);

  const audit = async (features = "audit_in_chat,audit_chat") =>
    [...(await t.call("dayan@dev", "GET", `/api/v1/audit?limit=200&features=${features}`)).data.entries].reverse();

  return { ...t, session, form, send, fromSession, toSession, page, audit };
}

export const txt = (name: string, content: string) => new File([content], name);
