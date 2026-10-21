import { createTestApp, stubTeamModule } from "../../testing/harness";
import { filesModule } from "../files/index";
import { sessionsModule } from "../sessions/index";
import { settingsModule } from "../settings/index";
import { requestsModule } from "./index";

// Escenario de los tests de requests: Dayan (A) pide a María (B). Leo puede pedir pero no enviar archivos.
export const members: Parameters<typeof stubTeamModule>[0] = [
  { id: "m-dayan", login: "dayan@dev", name: "Dayan", disabled: false, perms: ["requests.send", "files.send", "team.admin"] },
  { id: "m-maria", login: "maria@dev", name: "María", disabled: false, perms: ["requests.send", "files.send"] },
  { id: "m-leo", login: "leo@dev", name: "Leo", disabled: false, perms: ["requests.send"] },
];
export const team = stubTeamModule(members);

export type Flow = Awaited<ReturnType<typeof setupFlow>>;

export const MODULES_UNDER_TEST = [team, settingsModule, sessionsModule, filesModule, requestsModule];

export async function setupFlow() {
  const t = createTestApp({ modules: MODULES_UNDER_TEST });
  await t.app.start();

  // Registra una sesión y abre su SSE (queda viva).
  async function session(login: string, name: string, parentPid: number) {
    const s = (await t.call(login, "POST", "/api/v1/sessions", { name, cwd: `/repo/${name}`, parentPid })).data;
    const stream = await t.openStream(login, `/api/v1/events/session/${s.id}`);
    return { id: s.id as string, close: stream.close };
  }

  const dayanFront = await session("dayan@dev", "frontend", 100);
  const mariaApi = await session("maria@dev", "backend-api", 200);
  const leoOps = await session("leo@dev", "ops", 300);

  function draftForm(meta: object, files: File[] = []) {
    const form = new FormData();
    form.set("meta", JSON.stringify(meta));
    for (const f of files) form.append("files", f);
    return form;
  }

  const createDraft = (login: string, meta: object, files: File[] = []) =>
    t.call(login, "POST", "/api/v1/drafts", draftForm(meta, files));

  // Borrador de solicitud de Dayan a María (con archivos opcionales).
  const requestDraft = (message = "¿Me apruebas el PR #12?", files: File[] = []) =>
    createDraft("dayan@dev", { kind: "request", sessionId: dayanFront.id, to: "m-maria", message }, files);

  // Solicitud ya autorizada y pendiente para María.
  async function pendingRequest(message?: string, files: File[] = []) {
    const d = (await requestDraft(message, files)).data;
    await t.call("dayan@dev", "POST", `/api/v1/drafts/${d.id}/authorize`);
    const ev = t.userEvents("m-maria").findLast((e) => e.type === "request.incoming");
    return ev.request as { id: string; status: string; deadline: number };
  }

  // Solicitud reenviada a la sesión de María.
  async function forwardedRequest(message?: string, files: File[] = []) {
    const r = await pendingRequest(message, files);
    await t.call("maria@dev", "POST", `/api/v1/requests/${r.id}/forward`, { sessionId: mariaApi.id });
    return r;
  }

  const responseDraft = (requestId: string, message = "Aprobado si pasan los tests", files: File[] = []) =>
    createDraft("maria@dev", { kind: "response", sessionId: mariaApi.id, requestId, message }, files);

  const getRequest = async (id: string) => {
    const evs = t.sent.filter((s) => s.data?.request?.id === id);
    return evs.at(-1)?.data.request;
  };

  return {
    ...t, dayanFront, mariaApi, leoOps, session, createDraft, draftForm, requestDraft, pendingRequest,
    forwardedRequest, responseDraft, getRequest,
  };
}
