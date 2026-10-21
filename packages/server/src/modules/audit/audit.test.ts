import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { API, type AuditEntry } from "@devi/protocol";
import { openDb } from "../../core/db";
import { createTestApp } from "../../testing/harness";
import { setupFlow, type Flow } from "../requests/fixture";
import { settingsModule } from "../settings/index";
import { teamModule } from "../team/index";
import { auditModule } from "./index";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const DAY = 86_400_000;

describe("auditoría del ciclo de solicitudes", () => {
  let f: Flow;
  afterEach(() => f.cleanup());

  const entries = async (): Promise<AuditEntry[]> => {
    const res = await f.call("dayan@dev", "GET", "/api/v1/audit?limit=200");
    expect(res.status).toBe(200);
    return [...res.data.entries].reverse(); // en orden cronológico
  };
  const actions = async () => (await entries()).map((e) => e.action);

  test("borrador creado: destinatario, archivos y SHA-256 del mensaje (nunca el texto)", async () => {
    f = await setupFlow({ extraModules: [auditModule] });
    const msg = "Secreto: la clave es 1234";
    await f.requestDraft(msg, [new File(["hola\n"], "log.txt")]);
    const [e] = await entries();
    expect(e).toMatchObject({ action: "draft.created", actorMemberId: "m-dayan", actorLogin: "dayan@dev", targetType: "draft" });
    expect(e!.details).toMatchObject({ kind: "request", to: "m-maria", toName: "María", messageSha256: sha(msg), sessionName: "frontend" });
    expect(JSON.parse(e!.details.files!)).toEqual([{ name: "log.txt", size: 5 }]);
    expect(JSON.stringify(e)).not.toContain("Secreto");
  });

  test("autorizar, reenviar a sesión, responder y aceptar la respuesta", async () => {
    f = await setupFlow({ extraModules: [auditModule] });
    const r = await f.forwardedRequest();
    const d = (await f.responseDraft(r.id)).data;
    await f.call("maria@dev", "POST", `/api/v1/drafts/${d.id}/authorize`);
    await f.call("dayan@dev", "POST", `/api/v1/requests/${r.id}/response/accept`);
    const all = await entries();
    expect(all.map((e) => e.action)).toEqual([
      "draft.created", "draft.authorized", "request.forwarded", "draft.created", "draft.authorized", "request.answered", "response.accepted",
    ]);
    const fwd = all.find((e) => e.action === "request.forwarded")!;
    expect(fwd).toMatchObject({ actorMemberId: "m-maria", targetType: "request", targetId: r.id });
    expect(fwd.details).toMatchObject({ sessionId: f.mariaApi.id, sessionName: "backend-api" });
    expect(all.find((e) => e.action === "request.answered")).toMatchObject({ actorMemberId: "m-maria", targetId: r.id });
  });

  test("descartar, caducar, aceptar, rechazar, plazo vencido, reenviar e ignorar", async () => {
    f = await setupFlow({ extraModules: [auditModule] });
    const d1 = (await f.requestDraft("uno")).data;
    await f.call("dayan@dev", "POST", `/api/v1/drafts/${d1.id}/discard`);
    await f.requestDraft("dos");
    f.clock.advance(16 * 60_000); // caduca el borrador (15 min)
    const a = await f.pendingRequest("tres");
    await f.call("maria@dev", "POST", `/api/v1/requests/${a.id}/accept`, {});
    const b = await f.pendingRequest("cuatro");
    await f.call("maria@dev", "POST", `/api/v1/requests/${b.id}/reject`, { reason: "no" });
    const c = await f.pendingRequest("cinco");
    f.clock.advance(61 * 60_000); // vence el plazo (1 h)
    await f.call("dayan@dev", "POST", `/api/v1/requests/${c.id}/resend`);
    f.clock.advance(61 * 60_000);
    await f.call("dayan@dev", "POST", `/api/v1/requests/${c.id}/ignore`);
    const all = await entries();
    const pick = (action: string) => all.filter((e) => e.action === action);
    expect(pick("draft.discarded")[0]).toMatchObject({ actorMemberId: "m-dayan", targetId: d1.id });
    expect(pick("draft.expired")[0]).toMatchObject({ actorLogin: "system" });
    expect(pick("draft.expired")[0]!.actorMemberId).toBeUndefined();
    expect(pick("request.accepted")[0]).toMatchObject({ actorMemberId: "m-maria", targetId: a.id });
    expect(pick("request.rejected")[0]).toMatchObject({ actorMemberId: "m-maria", targetId: b.id });
    expect(pick("request.timed_out").map((e) => e.targetId)).toEqual([c.id, c.id]);
    expect(pick("request.timed_out")[0]!.actorLogin).toBe("system");
    expect(pick("request.resent")[0]).toMatchObject({ actorMemberId: "m-dayan", targetId: c.id });
    expect(pick("request.ignored")[0]).toMatchObject({ actorMemberId: "m-dayan", targetId: c.id });
  });

  test("respuesta enviada a sesión y archivo descargado", async () => {
    f = await setupFlow({ extraModules: [auditModule] });
    const r = await f.pendingRequest("con archivo", [new File(["x"], "a.txt")]);
    await f.call("maria@dev", "POST", `/api/v1/requests/${r.id}/accept`, {});
    await f.call("dayan@dev", "POST", `/api/v1/requests/${r.id}/response/forward`, { sessionId: f.dayanFront.id });
    const fileId = (await f.getRequest(r.id)).files[0].id;
    expect((await f.call("maria@dev", "GET", `/api/v1/files/${fileId}`)).status).toBe(200);
    const all = await entries();
    expect(all.find((e) => e.action === "response.forwarded")).toMatchObject({ actorMemberId: "m-dayan", targetId: r.id });
    expect(all.find((e) => e.action === "response.forwarded")!.details.sessionName).toBe("frontend");
    const dl = all.find((e) => e.action === "file.downloaded")!;
    expect(dl).toMatchObject({ actorMemberId: "m-maria", targetType: "file", targetId: fileId });
    expect(dl.details).toMatchObject({ name: "a.txt", sha256: sha("x") });
  });
});

describe("auditoría de equipo, ajustes y accesos", () => {
  let t: ReturnType<typeof createTestApp>;
  afterEach(() => t.cleanup());
  const ADMIN = "dayan@asai.digital";

  async function started(opts: { db?: ReturnType<typeof openDb>; allowedDomains?: string[] } = {}) {
    t = createTestApp({ modules: [teamModule, settingsModule, auditModule], adminLogin: ADMIN, db: opts.db, allowedDomains: opts.allowedDomains });
    await t.app.start();
    return t;
  }
  const entries = async (): Promise<AuditEntry[]> => [...(await t.call(ADMIN, "GET", "/api/v1/audit?limit=200")).data.entries].reverse();
  const adminId = async () => (await t.call(ADMIN, "GET", "/api/v1/me")).data.member.id as string;
  const alerts = async () => t.userEvents(await adminId()).filter((e) => e.type === "audit.alert").map((e) => e.entry as AuditEntry);

  test("personas: crear, cambiar (qué campos), desactivar y borrar; con alertas a los admins", async () => {
    await started();
    const m = (await t.call(ADMIN, "POST", "/api/v1/team/members", { login: "ana@asai.digital", name: "Ana" })).data;
    await t.call(ADMIN, "PATCH", `/api/v1/team/members/${m.id}`, { name: "Ana B", description: "QA" });
    await t.call(ADMIN, "PATCH", `/api/v1/team/members/${m.id}`, { disabled: true });
    await t.call(ADMIN, "DELETE", `/api/v1/team/members/${m.id}`);
    const all = await entries();
    expect(all.map((e) => e.action)).toEqual(["member.created", "member.updated", "member.disabled", "member.deleted"]);
    expect(all[0]).toMatchObject({ actorLogin: ADMIN, targetType: "member", targetId: m.id });
    expect(all[0]!.details).toMatchObject({ login: "ana@asai.digital" });
    expect(all[1]!.details.fields).toBe("name,description");
    expect(JSON.parse(all[1]!.details.changes!)).toEqual({ name: ["Ana", "Ana B"], description: ["", "QA"] });
    // member.updated sin cambio de roles no alerta; el resto sí.
    expect((await alerts()).map((e) => e.action)).toEqual(["member.created", "member.disabled", "member.deleted"]);
  });

  test("dar el rol de admin a alguien alerta (nuevo admin)", async () => {
    await started();
    const adminRole = (await t.call(ADMIN, "GET", "/api/v1/team")).data.roles.find((r: { perms: string[] }) => r.perms.includes("team.admin"));
    const m = (await t.call(ADMIN, "POST", "/api/v1/team/members", { login: "ana@asai.digital", name: "Ana" })).data;
    await t.call(ADMIN, "PATCH", `/api/v1/team/members/${m.id}`, { roleIds: [adminRole.id] });
    const upd = (await alerts()).find((e) => e.action === "member.updated")!;
    expect(upd.details).toMatchObject({ fields: "roleIds", becameAdmin: "true" });
  });

  test("roles: permisos antes y después; ajustes antes y después; exportar la base", async () => {
    await started();
    const role = (await t.call(ADMIN, "POST", "/api/v1/team/roles", { name: "Backend", perms: ["requests.send"] })).data;
    await t.call(ADMIN, "PATCH", `/api/v1/team/roles/${role.id}`, { perms: ["requests.send", "files.send"] });
    await t.call(ADMIN, "DELETE", `/api/v1/team/roles/${role.id}`);
    await t.call(ADMIN, "PATCH", "/api/v1/settings", { requestTimeoutMs: 120_000 });
    await t.call(ADMIN, "GET", "/api/v1/settings/export");
    const all = await entries();
    expect(all.map((e) => e.action)).toEqual(["role.created", "role.updated", "role.deleted", "settings.updated", "db.exported"]);
    expect(JSON.parse(all[1]!.details.permsBefore!)).toEqual(["requests.send"]);
    expect(JSON.parse(all[1]!.details.permsAfter!)).toEqual(["requests.send", "files.send"]);
    expect(JSON.parse(all[3]!.details.before!).requestTimeoutMs).toBe(3_600_000);
    expect(JSON.parse(all[3]!.details.after!).requestTimeoutMs).toBe(120_000);
    expect((await alerts()).map((e) => e.action)).toEqual(["role.created", "role.updated", "role.deleted", "settings.updated"]);
  });

  test("logins rechazados: como mucho uno por login cada 10 min; también por dominio", async () => {
    await started({ allowedDomains: ["asai.digital"] });
    await t.call("nadie@asai.digital", "GET", "/api/v1/me");
    await t.call("nadie@asai.digital", "GET", "/api/v1/team");
    await t.call("intruso@gmail.com", "GET", "/api/v1/me");
    t.clock.advance(9 * 60_000);
    await t.call("nadie@asai.digital", "GET", "/api/v1/me");
    t.clock.advance(2 * 60_000);
    await t.call("nadie@asai.digital", "GET", "/api/v1/me");
    const rejected = (await entries()).filter((e) => e.action === "login.rejected");
    expect(rejected.map((e) => [e.actorLogin, e.details.reason])).toEqual([
      ["nadie@asai.digital", "unknown_login"], ["intruso@gmail.com", "domain"], ["nadie@asai.digital", "unknown_login"],
    ]);
    expect(rejected[0]).toMatchObject({ targetType: "login", targetId: "nadie@asai.digital" });
    expect(rejected[0]!.actorMemberId).toBeUndefined();
    expect((await alerts()).filter((e) => e.action === "login.rejected")).toHaveLength(3);
  });

  test("GET /audit: solo admins, paginado de lo más nuevo a lo más viejo", async () => {
    await started();
    for (let i = 0; i < 5; i++) await t.call(ADMIN, "POST", "/api/v1/team/roles", { name: `R${i}` });
    const p1 = (await t.call(ADMIN, "GET", "/api/v1/audit?limit=2")).data;
    expect(p1.entries.map((e: AuditEntry) => e.details.name)).toEqual(["R4", "R3"]);
    expect(typeof p1.nextBefore).toBe("number");
    const p2 = (await t.call(ADMIN, "GET", `/api/v1/audit?limit=2&before=${p1.nextBefore}`)).data;
    expect(p2.entries.map((e: AuditEntry) => e.details.name)).toEqual(["R2", "R1"]);
    const p3 = (await t.call(ADMIN, "GET", `/api/v1/audit?limit=2&before=${p2.nextBefore}`)).data;
    expect(p3.entries.map((e: AuditEntry) => e.details.name)).toEqual(["R0"]);
    expect(p3.nextBefore).toBeUndefined();
    expect((await t.call(ADMIN, "GET", "/api/v1/audit?limit=0")).status).toBe(400);
    await t.call(ADMIN, "POST", "/api/v1/team/members", { login: "ana@asai.digital", name: "Ana" });
    const res = await t.call("ana@asai.digital", "GET", "/api/v1/audit");
    expect(res.status).toBe(403);
  });

  test("solo se añade: ninguna ruta lo cambia y la tabla rechaza UPDATE", async () => {
    await started();
    const auditRoutes = Object.values(API).filter((r) => r.path.startsWith("/api/v1/audit"));
    expect(auditRoutes.map((r) => r.method)).toEqual(["GET"]);
    await t.call(ADMIN, "POST", "/api/v1/team/roles", { name: "R" });
    expect(() => t.app.ctx.db.run("UPDATE audit_log SET action = 'x'")).toThrow("solo se añade");
  });

  test("retención: se borra lo de más de 365 días, una vez al día", async () => {
    await started();
    await t.call(ADMIN, "POST", "/api/v1/team/roles", { name: "Viejo" });
    t.clock.advance(300 * DAY);
    await t.call(ADMIN, "POST", "/api/v1/team/roles", { name: "Nuevo" });
    t.clock.advance(66 * DAY);
    expect((await entries()).map((e) => e.details.name)).toEqual(["Nuevo"]);
  });
});
