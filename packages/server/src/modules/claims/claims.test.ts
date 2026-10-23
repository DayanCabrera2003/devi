import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { CLAIM_LIMITS, type SessionDelivery } from "@devi/protocol";
import type { DeviModule } from "../../core/module";
import { HttpError } from "../../core/http";
import { createTestApp, stubTeamModule } from "../../testing/harness";
import { sessionsModule } from "../sessions/index";
import { settingsModule } from "../settings/index";
import { claimsModule } from "./index";

const members: Parameters<typeof stubTeamModule>[0] = [
  { id: "m-dayan", login: "dayan@dev", name: "Dayan", disabled: false, perms: ["requests.send"] },
  { id: "m-maria", login: "maria@dev", name: "María", disabled: false, perms: ["requests.send"] },
];

// Manejador falso de "request": "abierta" y "cerrada" existen; delivered guarda los canjes.
const delivered: { id: string; sessionId: string; details: unknown }[] = [];
let failNext = false;
const fakeTargets: DeviModule = {
  name: "fake-targets",
  migrations: [],
  routes(_r, ctx) {
    ctx.services.provide("requestTargets", {
      request: {
        check(access, id) {
          if (access.memberId !== "m-maria") throw new HttpError(403, "esta solicitud no es para ti", { code: "forbidden" });
          if (id !== "abierta") throw new HttpError(409, "la solicitud ya está accepted", { code: "conflict" });
        },
        deliverTo(access, id, sessionId, details): SessionDelivery {
          this.check(access, id);
          if (failNext) { failNext = false; throw new HttpError(409, "fallo simulado", { code: "conflict" }); }
          delivered.push({ id, sessionId, details });
          return { kind: "request", content: `entrega ${id}`, meta: { request_id: id, inbox_id: "ib1" } };
        },
      },
    });
  },
};

const apps: ReturnType<typeof createTestApp>[] = [];

async function setup() {
  const t = createTestApp({ modules: [stubTeamModule(members), settingsModule, sessionsModule, claimsModule, fakeTargets] });
  apps.push(t);
  await t.app.start();
  const create = (login: string, target: unknown, o: { origin?: string | null } = {}) =>
    t.call(login, "POST", "/api/v1/claims", { target }, o);
  const redeem = (login: string, code: string, parentPid = 200) =>
    t.call(login, "POST", "/api/v1/claims/redeem", { code, claudeSessionId: "c1", parentPid, machine: "M1" }, { origin: null });
  const register = (login: string, parentPid = 200) =>
    t.call(login, "POST", "/api/v1/sessions", { name: "nueva", cwd: "/r", parentPid, machine: "M1", features: ["chat"] }, { origin: null });
  return { ...t, create, redeem, register };
}

beforeEach(() => { delivered.length = 0; failNext = false; });
afterEach(() => { for (const t of apps.splice(0)) t.cleanup(); });

describe("códigos de entrega", () => {
  test("crear (solo desde la app) y canjear desde la sesión nueva", async () => {
    const t = await setup();
    expect((await t.create("maria@dev", { type: "request", id: "abierta" }, { origin: null })).status).toBe(403);
    const c = await t.create("maria@dev", { type: "request", id: "abierta" });
    expect(c.status).toBe(200);
    expect(c.data.code).toMatch(/^[A-Z2-9]{6}$/);
    expect(c.data.status).toBe("open");
    const s = (await t.register("maria@dev")).data;
    const r = await t.redeem("maria@dev", c.data.code);
    expect(r.status).toBe(200);
    expect(r.data.delivery.content).toBe("entrega abierta");
    expect(delivered).toEqual([{ id: "abierta", sessionId: s.id, details: { claimCode: c.data.code } }]);
    expect(t.userEvents("m-maria").findLast((e) => e.type === "claim.updated").claim.status).toBe("used");
  });

  test("un solo uso", async () => {
    const t = await setup();
    const { code } = (await t.create("maria@dev", { type: "request", id: "abierta" })).data;
    await t.register("maria@dev");
    await t.redeem("maria@dev", code);
    const again = await t.redeem("maria@dev", code);
    expect(again.status).toBe(409);
    expect(again.data.code).toBe("claim_used");
  });

  test("caduca a los 10 min y avisa a la app", async () => {
    const t = await setup();
    const { code } = (await t.create("maria@dev", { type: "request", id: "abierta" })).data;
    await t.register("maria@dev");
    t.clock.advance(CLAIM_LIMITS.ttlMs + 1);
    const r = await t.redeem("maria@dev", code);
    expect(r.status).toBe(410);
    expect(r.data.code).toBe("claim_expired");
    expect(t.userEvents("m-maria").findLast((e) => e.type === "claim.updated").claim.status).toBe("expired");
  });

  test("el código de otra persona es como uno inexistente", async () => {
    const t = await setup();
    const { code } = (await t.create("maria@dev", { type: "request", id: "abierta" })).data;
    await t.register("dayan@dev", 100);
    const r = await t.redeem("dayan@dev", code, 100);
    expect(r.status).toBe(404);
    expect(r.data.code).toBe("claim_not_found");
  });

  test("no se crea para un elemento ajeno o cerrado", async () => {
    const t = await setup();
    expect((await t.create("dayan@dev", { type: "request", id: "abierta" })).status).toBe(403);
    expect((await t.create("maria@dev", { type: "request", id: "cerrada" })).status).toBe(409);
    expect((await t.create("maria@dev", { type: "chat", id: "x" })).status).toBe(400); // sin manejador de chat
  });

  test("sin sesión emparejada: session_unknown y el código sigue valiendo", async () => {
    const t = await setup();
    const { code } = (await t.create("maria@dev", { type: "request", id: "abierta" })).data;
    const r = await t.redeem("maria@dev", code);
    expect(r.status).toBe(409);
    expect(r.data.code).toBe("session_unknown");
    await t.register("maria@dev");
    expect((await t.redeem("maria@dev", code)).status).toBe(200);
  });

  test("si la entrega falla, la reserva se libera", async () => {
    const t = await setup();
    const { code } = (await t.create("maria@dev", { type: "request", id: "abierta" })).data;
    await t.register("maria@dev");
    failNext = true;
    expect((await t.redeem("maria@dev", code)).status).toBe(409);
    expect((await t.redeem("maria@dev", code)).status).toBe(200);
  });

  test("cancelar (solo desde la app) y listar los míos", async () => {
    const t = await setup();
    const { code } = (await t.create("maria@dev", { type: "request", id: "abierta" })).data;
    expect((await t.call("maria@dev", "GET", "/api/v1/claims", undefined, { origin: null })).data).toHaveLength(1);
    expect((await t.call("dayan@dev", "DELETE", `/api/v1/claims/${code}`)).status).toBe(404);
    expect((await t.call("maria@dev", "DELETE", `/api/v1/claims/${code}`)).status).toBe(200);
    expect((await t.call("maria@dev", "GET", "/api/v1/claims")).data).toHaveLength(0);
    await t.register("maria@dev");
    expect((await t.redeem("maria@dev", code)).data.code).toBe("claim_used"); // cancelado = ya no vale
  });

  test("los reintentos con session_unknown no gastan el límite; los códigos inventados sí", async () => {
    const t = await setup();
    const { code } = (await t.create("maria@dev", { type: "request", id: "abierta" })).data;
    for (let i = 0; i < 15; i++) expect((await t.redeem("maria@dev", code)).data.code).toBe("session_unknown");
    for (let i = 0; i < 10; i++) expect((await t.redeem("maria@dev", "AAAAAA")).status).toBe(404);
    expect((await t.redeem("maria@dev", "AAAAAA")).status).toBe(429);
  });

  test("como mucho 10 vivos por persona", async () => {
    const t = await setup();
    for (let i = 0; i < CLAIM_LIMITS.maxOpenPerMember; i++) {
      expect((await t.create("maria@dev", { type: "request", id: "abierta" })).status).toBe(200);
    }
    const over = await t.create("maria@dev", { type: "request", id: "abierta" });
    expect(over.status).toBe(409);
    expect(over.data.code).toBe("too_many_claims");
  });
});
