import { afterEach, describe, expect, test } from "bun:test";
import { type Flow, setupFlow } from "./fixture";

let f: Flow;
afterEach(() => f.cleanup());

const DAY = 86_400_000;
const txt = (name: string, content: string) => new File([content], name);
// Como el hook: sin Origin (no son rutas humanas).
const agent = { origin: null };
const inbox = (login: string, parentPid: number, claudeSessionId = "cs-x") =>
  f.call(login, "GET", `/api/v1/sessions/inbox?parentPid=${parentPid}&claudeSessionId=${claudeSessionId}`, undefined, agent);
const ack = (login: string, ids: string[]) => f.call(login, "POST", "/api/v1/sessions/inbox/ack", { ids }, agent);

describe("bandeja de sesión (entregas sin canal)", () => {
  test("una solicitud reenviada queda en la bandeja con el mismo inbox_id que la entrega; ack la quita", async () => {
    f = await setupFlow();
    const r = await f.forwardedRequest("¿Me apruebas el PR #12?", [txt("diff.patch", "+1\n")]);
    const [ev] = f.deliveries(f.mariaApi.id);
    const res = await inbox("maria@dev", 200);
    expect(res.status).toBe(200);
    expect(res.data).toHaveLength(1);
    const [item] = res.data;
    expect(item).toMatchObject({ kind: "request", content: ev.content, meta: { request_id: r.id } });
    expect(ev.meta.inbox_id).toBe(item.id);
    expect(JSON.parse(item.meta.files)).toEqual([{ id: expect.any(String), name: "diff.patch" }]);

    // Otra persona no puede confirmarla.
    expect((await ack("dayan@dev", [item.id])).status).toBe(200);
    expect(await inbox("maria@dev", 200)).toMatchObject({ data: [{ id: item.id }] });
    expect((await ack("maria@dev", [item.id])).data).toEqual({ ok: true });
    expect((await inbox("maria@dev", 200)).data).toEqual([]);
  });

  test("también por claude_session_id tras un hook; sin pareja → lista vacía", async () => {
    f = await setupFlow();
    await f.call("maria@dev", "POST", "/api/v1/sessions/hook", { claudeSessionId: "cs-m", cwd: "/r", parentPid: 200, status: "working" }, agent);
    await f.forwardedRequest();
    expect((await inbox("maria@dev", 999, "cs-m")).data).toHaveLength(1);
    expect((await inbox("maria@dev", 999, "otra")).data).toEqual([]);
    expect((await inbox("dayan@dev", 200)).data).toEqual([]); // el pid 200 es de María
  });

  test("dos sesiones de la misma persona: la bandeja de una nunca entrega lo de la otra", async () => {
    f = await setupFlow();
    // Otra sesión de María en la MISMA carpeta y máquina, con otro Claude Code (pid 201).
    const other = (await f.call("maria@dev", "POST", "/api/v1/sessions", { name: "backend-api", cwd: "/repo/backend-api", parentPid: 201 }, agent)).data;
    expect(other.name).toBe("backend-api (2)");
    await f.forwardedRequest(); // reenviada a la primera (pid 200)
    expect((await inbox("maria@dev", 201, "cs-otra")).data).toEqual([]);
    expect((await inbox("maria@dev", 200, "cs-primera")).data).toHaveLength(1);
    // Aunque la otra herede el claudeSessionId de la primera, su pid manda.
    await f.call("maria@dev", "POST", "/api/v1/sessions/hook", { claudeSessionId: "cs-primera", cwd: "/r", parentPid: 200, status: "working" }, agent);
    expect((await inbox("maria@dev", 201, "cs-primera")).data).toEqual([]);
  });

  test("draft_authorized y draft_discarded van a la bandeja del autor, en orden; debug no", async () => {
    f = await setupFlow({ dev: true });
    await f.pendingRequest();
    const d = (await f.requestDraft("otra")).data;
    await f.call("dayan@dev", "POST", `/api/v1/drafts/${d.id}/discard`);
    await f.call("dayan@dev", "POST", "/api/v1/debug/push", { sessionId: f.dayanFront.id, content: "hola" });
    const items = (await inbox("dayan@dev", 100)).data;
    expect(items.map((i: { kind: string }) => i.kind)).toEqual(["draft_authorized", "draft_discarded"]);
    const kinds = f.deliveries(f.dayanFront.id).map((d) => [d.kind, d.meta.inbox_id]);
    expect(kinds).toEqual([["draft_authorized", items[0].id], ["draft_discarded", items[1].id], ["debug", undefined]]);
  });

  test("la respuesta reenviada a la sesión de A también", async () => {
    f = await setupFlow();
    const r = await f.forwardedRequest();
    const d = (await f.responseDraft(r.id)).data;
    await f.call("maria@dev", "POST", `/api/v1/drafts/${d.id}/authorize`);
    await f.call("dayan@dev", "POST", `/api/v1/requests/${r.id}/response/forward`, { sessionId: f.dayanFront.id });
    const kinds = (await inbox("dayan@dev", 100)).data.map((i: { kind: string }) => i.kind);
    expect(kinds).toEqual(["draft_authorized", "response"]);
  });

  test("las entregas sin confirmar caducan a los 7 días", async () => {
    f = await setupFlow();
    await f.forwardedRequest();
    f.clock.advance(6 * DAY);
    expect((await inbox("maria@dev", 200)).data).toHaveLength(1);
    f.clock.advance(DAY + 2 * 3_600_000);
    expect((await inbox("maria@dev", 200)).data).toEqual([]);
  });
});
