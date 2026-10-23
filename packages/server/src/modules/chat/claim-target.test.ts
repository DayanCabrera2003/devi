import { describe, expect, test } from "bun:test";
import type { AuditEntry } from "@devi/protocol";
import type { Access } from "../../core/auth";
import { createTestApp, stubTeamModule } from "../../testing/harness";
import { auditModule } from "../audit/index";
import { claimsModule } from "../claims/index";
import { filesModule } from "../files/index";
import { requestsModule } from "../requests/index";
import { sessionsModule } from "../sessions/index";
import { settingsModule } from "../settings/index";
import { chatModule } from "./index";

const members: Parameters<typeof stubTeamModule>[0] = [
  { id: "m-dayan", login: "dayan@dev", name: "Dayan", disabled: false, perms: ["requests.send", "files.send", "team.admin"] },
  { id: "m-maria", login: "maria@dev", name: "María", disabled: false, perms: ["requests.send", "files.send"] },
  { id: "m-leo", login: "leo@dev", name: "Leo", disabled: false, perms: ["requests.send"] },
];

async function setup() {
  const t = createTestApp({
    modules: [stubTeamModule(members), settingsModule, sessionsModule, filesModule, requestsModule, chatModule, auditModule, claimsModule],
  });
  await t.app.start();
  const form = new FormData();
  form.set("meta", JSON.stringify({ to: "m-maria", text: "¿Lo miras?" }));
  const msg = (await t.call("dayan@dev", "POST", "/api/v1/chat", form)).data;
  const register = async (features: string[], login = "maria@dev", parentPid = 900) =>
    (await t.call(login, "POST", "/api/v1/sessions", { name: "nueva", cwd: "/n", parentPid, machine: "", features }, { origin: null })).data;
  const redeem = (code: string) =>
    t.call("maria@dev", "POST", "/api/v1/claims/redeem", { code, claudeSessionId: "cx", parentPid: 900, machine: "" }, { origin: null });
  const inbox = () =>
    t.call("maria@dev", "GET", "/api/v1/sessions/inbox?parentPid=900&claudeSessionId=cx", undefined, { origin: null });
  const audit = async (): Promise<AuditEntry[]> => (await t.call("dayan@dev", "GET", "/api/v1/audit?limit=200&features=audit_chat")).data.entries;
  return { ...t, msg, register, redeem, inbox, audit };
}

describe("mensaje del chat a una sesión nueva", () => {
  test("llega como chat y queda auditado con el código", async () => {
    const t = await setup();
    const { code } = (await t.call("maria@dev", "POST", "/api/v1/claims", { target: { type: "chat", id: t.msg.id } })).data;
    const s = await t.register(["chat"]);
    const res = await t.redeem(code);
    expect(res.status).toBe(200);
    expect(res.data.delivery.kind).toBe("chat");
    expect(res.data.delivery.meta.message_id).toBe(t.msg.id);
    expect(t.deliveries(s.id)).toHaveLength(0); // no se empujó por el canal
    const entry = (await t.audit()).find((e) => e.action === "chat.to_session" && e.targetId === t.msg.id);
    expect(entry?.details).toMatchObject({ claimCode: code, sessionId: s.id });
  });

  test("no se guarda en la bandeja: chat no es un tipo de bandeja", async () => {
    const t = await setup();
    const { code } = (await t.call("maria@dev", "POST", "/api/v1/claims", { target: { type: "chat", id: t.msg.id } })).data;
    await t.register(["chat"]);
    const res = await t.redeem(code);
    // chat no está en INBOX_KINDS: la entrega no se guarda en la bandeja ni lleva inbox_id; solo vuelve al hook.
    expect(res.data.delivery.meta.inbox_id).toBeUndefined();
    expect((await t.inbox()).data).toEqual([]);
  });

  test("una sesión sin la función chat: session_outdated", async () => {
    const t = await setup();
    const { code } = (await t.call("maria@dev", "POST", "/api/v1/claims", { target: { type: "chat", id: t.msg.id } })).data;
    await t.register([]);
    const res = await t.redeem(code);
    expect(res.status).toBe(409);
    expect(res.data.code).toBe("session_outdated");
  });

  test("Leo no es parte del mensaje", async () => {
    const t = await setup();
    expect((await t.call("leo@dev", "POST", "/api/v1/claims", { target: { type: "chat", id: t.msg.id } })).status).toBe(404);
  });

  test("una sesión de otra persona: session_gone y nada cambia", async () => {
    const t = await setup();
    const leoSession = await t.register(["chat"], "leo@dev", 901);
    const handler = t.app.ctx.services.get("chatTargets").chat!;
    const maria: Access = { memberId: "m-maria", perms: new Set() };
    let err: unknown;
    try {
      handler.deliverTo(maria, t.msg.id, leoSession.id, {});
    } catch (e) {
      err = e;
    }
    expect(err).toMatchObject({ status: 409, extra: { code: "session_gone" } });
    expect((await t.audit()).some((e) => e.action === "chat.to_session")).toBe(false);
  });
});
