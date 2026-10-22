import { afterEach, describe, expect, test } from "bun:test";
import type { AuditEntry, KnowledgeEntry } from "@devi/protocol";
import { auditModule } from "../audit/index";
import { setupFlow, type Flow } from "../requests/fixture";
import { knowledgeModule } from "./index";

describe("base de conocimiento del equipo", () => {
  let f: Flow;
  afterEach(() => f.cleanup());

  const start = async () => (f = await setupFlow({ extraModules: [knowledgeModule, auditModule] }));
  const search = async (q: string, login = "leo@dev", limit?: number): Promise<KnowledgeEntry[]> => {
    const qs = new URLSearchParams({ q, ...(limit ? { limit: String(limit) } : {}) });
    const res = await f.call(login, "GET", `/api/v1/knowledge?${qs}`, undefined, { origin: null });
    expect(res.status).toBe(200);
    return res.data.entries;
  };
  // Dayan pregunta, María responde desde su sesión (borrador de respuesta) y lo autoriza en la app.
  async function answered(question: string, answer: string, opts: { share?: boolean; approval?: "app" | "chat" } = {}) {
    const r = await f.forwardedRequest(question);
    const meta = { kind: "response", sessionId: f.mariaApi.id, requestId: r.id, message: answer, approval: opts.approval ?? "app", shareWithTeam: opts.share ?? true };
    const d = (await f.createDraft("maria@dev", meta)).data;
    if (d.status === "awaiting") await f.call("maria@dev", "POST", `/api/v1/drafts/${d.id}/authorize`);
    return { request: r, draft: d };
  }
  const eventsOf = (memberId: string, type: string) => f.userEvents(memberId).filter((e) => e.type === type);

  test("respuesta compartida al autorizarla en la app: se encuentra por texto (sin acentos ni mayúsculas) con quién y cuándo", async () => {
    await start();
    const { request, draft } = await answered("¿Cómo despliego la API en staging?", "Con `make deploy-staging` desde la rama main.");
    expect(draft.shareWithTeam).toBe(true);
    const [e] = await search("DESPLIEGO staging");
    expect(e).toMatchObject({
      requestId: request.id, question: "¿Cómo despliego la API en staging?", answer: "Con `make deploy-staging` desde la rama main.",
      askedBy: "m-dayan", askedByName: "Dayan", answeredBy: "m-maria", answeredByName: "María", createdAt: f.clock.now(),
    });
    expect(await search("como despliego")).toHaveLength(1); // sin tilde
    expect(await search("despl")).toHaveLength(1); // prefijo
    expect(eventsOf("m-maria", "knowledge.saved").map((x) => x.entry.id)).toEqual([e!.id]);
    const audit = (await f.call("dayan@dev", "GET", "/api/v1/audit?limit=200")).data.entries as AuditEntry[];
    expect(audit.find((a) => a.action === "knowledge.shared")).toMatchObject({ actorMemberId: "m-maria", targetType: "knowledge", targetId: e!.id });
  });

  test("el borrador de respuesta lleva la marca (la app la enseña al autorizar)", async () => {
    await start();
    const r = await f.forwardedRequest("¿Puerto de Redis en dev?");
    await f.createDraft("maria@dev", { kind: "response", sessionId: f.mariaApi.id, requestId: r.id, message: "6380", shareWithTeam: true });
    expect(eventsOf("m-maria", "draft.awaiting").at(-1)!.draft.shareWithTeam).toBe(true);
  });

  test("sin la opción no se guarda nada; tampoco si el borrador se descarta", async () => {
    await start();
    await answered("¿Dónde están los logs?", "En Grafana, panel API.", { share: false });
    const r = await f.forwardedRequest("¿Y las métricas?");
    const d = (await f.createDraft("maria@dev", { kind: "response", sessionId: f.mariaApi.id, requestId: r.id, message: "En Grafana también", shareWithTeam: true })).data;
    await f.call("maria@dev", "POST", `/api/v1/drafts/${d.id}/discard`);
    expect(await search("grafana")).toEqual([]);
  });

  test("aprobada en el chat: se guarda al enviarse", async () => {
    await start();
    await answered("¿Qué versión de Node usamos?", "Node 22 LTS, fijada en .nvmrc.", { approval: "chat" });
    expect((await search("node"))[0]!.answer).toBe("Node 22 LTS, fijada en .nvmrc.");
  });

  test("aceptada en la app con nota y la casilla: se guarda la nota; sin nota no hay nada que guardar", async () => {
    await start();
    const a = await f.pendingRequest("¿Me das acceso al bucket de facturas?");
    await f.call("maria@dev", "POST", `/api/v1/requests/${a.id}/accept`, { note: "Hecho: rol storage.objectViewer en GCP.", shareWithTeam: true });
    const b = await f.pendingRequest("¿Me das acceso al bucket de logs?");
    await f.call("maria@dev", "POST", `/api/v1/requests/${b.id}/accept`, { shareWithTeam: true });
    const found = await search("bucket");
    expect(found.map((e) => e.requestId)).toEqual([a.id]);
    expect(found[0]!.answer).toBe("Hecho: rol storage.objectViewer en GCP.");
  });

  test("con posibles secretos (en la pregunta o en la respuesta) no se publica y se avisa a quien respondió", async () => {
    await start();
    const { request } = await answered("¿Cuál es el token del bot?", "Usa ghp_abcdefghijklmnopqrstuvwxyz0123456789AB");
    await answered("Tengo password=hunter22secret, ¿la cambio?", "Sí, cámbiala ya.");
    expect(await search("token")).toEqual([]);
    expect(await search("cambio")).toEqual([]);
    const refused = eventsOf("m-maria", "knowledge.refused");
    expect(refused).toHaveLength(2);
    expect(refused[0]).toMatchObject({ requestId: request.id });
    expect(refused[0]!.reasons.join(" ")).toContain("GitHub");
    expect(JSON.stringify(refused)).not.toContain("hunter22secret");
    expect(eventsOf("m-maria", "knowledge.saved")).toEqual([]);
  });

  test("búsqueda: sin texto, las más recientes; todas las palabras cuentan; símbolos de FTS no rompen; limit", async () => {
    await start();
    await answered("¿Cómo reinicio el worker de colas?", "systemctl restart colas-worker");
    f.clock.advance(60_000);
    await answered("¿Cómo reinicio la base de datos?", "No la reinicies: avisa a Leo.");
    const recent = await search("");
    expect(recent.map((e) => e.question)).toEqual(["¿Cómo reinicio la base de datos?", "¿Cómo reinicio el worker de colas?"]);
    expect((await search("reinicio colas")).map((e) => e.answer)).toEqual(["systemctl restart colas-worker"]);
    expect(await search('"colas*" (reinicio: -')).toHaveLength(1);
    expect((await search('NEAR( OR " *')).length).toBeLessThanOrEqual(2); // no da error
    expect(await search("reinicio", "leo@dev", 1)).toHaveLength(1);
    // Si ninguna entrada tiene todas las palabras, vale cualquiera de ellas (mejor algo que nada).
    expect(await search("colas kubernetes")).toHaveLength(1);
    expect(await search("kubernetes")).toEqual([]);
  });

  test("retirar: solo quien respondió o un admin, y solo desde la app", async () => {
    await start();
    await answered("¿Quién aprueba los PR de infra?", "Leo o yo.");
    await answered("¿Hay entorno de QA?", "Sí, qa.interno.");
    const [qa, infra] = await search("");
    const del = (login: string, id: string, origin?: null) => f.call(login, "DELETE", `/api/v1/knowledge/${id}`, undefined, origin === null ? { origin: null } : {});
    expect((await del("leo@dev", infra!.id)).status).toBe(403);
    expect((await del("maria@dev", infra!.id, null)).status).toBe(403); // sin Origin de la app (un agente)
    expect((await del("maria@dev", infra!.id)).status).toBe(200);
    expect((await del("dayan@dev", qa!.id)).status).toBe(200); // admin
    expect((await del("dayan@dev", qa!.id)).status).toBe(404);
    expect(await search("")).toEqual([]);
    const audit = (await f.call("dayan@dev", "GET", "/api/v1/audit?limit=200")).data.entries as AuditEntry[];
    expect(audit.filter((a) => a.action === "knowledge.withdrawn").map((a) => a.actorMemberId).sort()).toEqual(["m-dayan", "m-maria"]);
  });
});
