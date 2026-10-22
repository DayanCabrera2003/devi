import { afterEach, describe, expect, test } from "bun:test";
import { DEFAULT_SETTINGS } from "@devi/protocol";
import { type AppFlow, setupAppFlow, txt } from "./app-fixture";

let f: AppFlow;
afterEach(() => f.cleanup());

const list = async (login: string, origin?: string | null) => (await f.call(login, "GET", "/api/v1/conversations", undefined, { origin }));
const page = (login: string, memberId: string, query = "") => f.call(login, "GET", `/api/v1/conversations/${memberId}${query}`);

// Borrador de solicitud desde una sesión (lo que hace el agente).
async function draftFrom(login: string, sessionId: string, to: string, message: string) {
  const form = new FormData();
  form.set("meta", JSON.stringify({ kind: "request", sessionId, to, message }));
  return (await f.call(login, "POST", "/api/v1/drafts", form)).data;
}

describe("GET /conversations", () => {
  test("una fila por cada otra persona activa, también sin historial", async () => {
    f = await setupAppFlow();
    const res = await list("dayan@dev");
    expect(res.status).toBe(200);
    // Sin historial: orden por nombre. Ni Dayan (quien llama) ni Pablo (desactivado).
    expect(res.data.items).toEqual([
      { memberId: "m-ana", lastAt: null, lastPreview: null, lastFromMe: false, waitingOnMe: 0 },
      { memberId: "m-leo", lastAt: null, lastPreview: null, lastFromMe: false, waitingOnMe: 0 },
      { memberId: "m-maria", lastAt: null, lastPreview: null, lastFromMe: false, waitingOnMe: 0 },
    ]);
    // Es una lectura: también sin Origin (CLI) y sin permisos.
    expect((await list("dayan@dev", null)).status).toBe(200);
    expect((await list("ana@dev")).status).toBe(200);
  });

  test("última actividad, quién la escribió, lo que me espera y el orden", async () => {
    f = await setupAppFlow();
    const dayan = await f.session("dayan@dev", "frontend", 100);
    const t0 = f.clock.now();
    // Dayan → María (app), y María responde; luego Leo → Dayan (pendiente para Dayan).
    const r1 = (await f.send("dayan@dev", { to: "m-maria", message: "x".repeat(200) })).data;
    f.clock.advance(1_000);
    await f.call("maria@dev", "POST", `/api/v1/requests/${r1.id}/reject`, { reason: "no tengo acceso" });
    f.clock.advance(1_000);
    await f.send("leo@dev", { to: "m-dayan", message: "¿me das acceso?" });
    f.clock.advance(1_000);
    // Borrador de Dayan para Ana, esperando autorización.
    await draftFrom("dayan@dev", dayan.id, "m-ana", "hola Ana");

    const items = (await list("dayan@dev")).data.items;
    expect(items).toEqual([
      { memberId: "m-leo", lastAt: t0 + 2_000, lastPreview: "¿me das acceso?", lastFromMe: false, waitingOnMe: 1 },
      { memberId: "m-maria", lastAt: t0 + 1_000, lastPreview: "no tengo acceso", lastFromMe: false, waitingOnMe: 1 },
      { memberId: "m-ana", lastAt: null, lastPreview: null, lastFromMe: false, waitingOnMe: 1 },
    ]);
    // Del otro lado: María respondió (lo último es suyo) y no le espera nada; Leo espera a Dayan.
    const maria = (await list("maria@dev")).data.items.find((i: { memberId: string }) => i.memberId === "m-dayan");
    expect(maria).toEqual({ memberId: "m-dayan", lastAt: t0 + 1_000, lastPreview: "no tengo acceso", lastFromMe: true, waitingOnMe: 0 });
    const leo = (await list("leo@dev")).data.items.find((i: { memberId: string }) => i.memberId === "m-dayan");
    expect(leo).toMatchObject({ lastFromMe: true, waitingOnMe: 0 });
    // Tras aceptar la respuesta, a Dayan ya no le espera nada con María.
    await f.call("dayan@dev", "POST", `/api/v1/requests/${r1.id}/response/accept`);
    expect((await list("dayan@dev")).data.items.find((i: { memberId: string }) => i.memberId === "m-maria").waitingOnMe).toBe(0);
  });

  test("vista previa: los primeros 120 caracteres", async () => {
    f = await setupAppFlow();
    await f.send("dayan@dev", { to: "m-maria", message: "a".repeat(130) });
    const item = (await list("maria@dev")).data.items.find((i: { memberId: string }) => i.memberId === "m-dayan");
    expect(item.lastPreview).toBe("a".repeat(120));
    expect(item.waitingOnMe).toBe(1);
  });

  test("un plazo vencido de una solicitud mía cuenta como pendiente para mí", async () => {
    f = await setupAppFlow();
    await f.send("dayan@dev", { to: "m-maria", message: "¿sigues?" });
    f.clock.advance(DEFAULT_SETTINGS.requestTimeoutMs + 1);
    const items = (await list("dayan@dev")).data.items;
    expect(items[0]).toMatchObject({ memberId: "m-maria", waitingOnMe: 1 });
    expect((await list("maria@dev")).data.items[0]).toMatchObject({ memberId: "m-dayan", waitingOnMe: 0 });
  });
});

describe("GET /conversations/:memberId", () => {
  test("solo las solicitudes entre los dos, en ambos sentidos y también cerradas, con respuesta y archivos", async () => {
    f = await setupAppFlow();
    const a = (await f.send("dayan@dev", { to: "m-maria", message: "uno" }, [txt("log.txt", "l")])).data;
    f.clock.advance(10);
    const b = (await f.send("maria@dev", { to: "m-dayan", message: "dos" })).data;
    f.clock.advance(10);
    await f.send("leo@dev", { to: "m-maria", message: "de Leo" });
    await f.send("dayan@dev", { to: "m-leo", message: "a Leo" });
    await f.call("maria@dev", "POST", `/api/v1/requests/${a.id}/reject`, { reason: "ahora no" });
    await f.call("dayan@dev", "POST", `/api/v1/requests/${a.id}/response/accept`);

    const res = await page("dayan@dev", "m-maria");
    expect(res.status).toBe(200);
    expect(res.data.nextBefore).toBeUndefined();
    expect(res.data.requests.map((r: { id: string }) => r.id)).toEqual([b.id, a.id]);
    expect(res.data.requests[1]).toMatchObject({
      status: "closed", outcome: "rejected", outcomeText: "ahora no", origin: "app", files: [{ name: "log.txt", direction: "request" }],
    });
    // María ve la misma conversación desde su lado.
    expect((await page("maria@dev", "m-dayan")).data.requests.map((r: { id: string }) => r.id)).toEqual([b.id, a.id]);
  });

  test("no se leen conversaciones ajenas: Leo con María solo ve lo suyo", async () => {
    f = await setupAppFlow();
    await f.send("dayan@dev", { to: "m-maria", message: "privado" });
    const leo = await page("leo@dev", "m-maria");
    expect(leo.status).toBe(200);
    expect(leo.data).toEqual({ requests: [] });
    // Ana (sin permisos) tampoco ve nada entre Dayan y María.
    expect((await page("ana@dev", "m-dayan")).data).toEqual({ requests: [] });
    expect((await page("ana@dev", "m-maria")).data).toEqual({ requests: [] });
  });

  test("paginación con before y limit; validación de la query y del compañero", async () => {
    f = await setupAppFlow();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      ids.push((await f.send("dayan@dev", { to: "m-maria", message: `m${i}` })).data.id);
      f.clock.advance(1_000);
    }
    const p1 = await page("dayan@dev", "m-maria", "?limit=2");
    expect(p1.data.requests.map((r: { id: string }) => r.id)).toEqual([ids[4], ids[3]]);
    const p2 = await page("dayan@dev", "m-maria", `?limit=2&before=${p1.data.nextBefore}`);
    expect(p2.data.requests.map((r: { id: string }) => r.id)).toEqual([ids[2], ids[1]]);
    const p3 = await page("dayan@dev", "m-maria", `?limit=2&before=${p2.data.nextBefore}`);
    expect(p3.data).toEqual({ requests: [expect.objectContaining({ id: ids[0] })] });
    expect((await page("dayan@dev", "m-maria")).data.requests).toHaveLength(5); // 30 por defecto
    expect((await page("dayan@dev", "m-maria", "?limit=0")).status).toBe(400);
    expect((await page("dayan@dev", "m-maria", "?limit=101")).status).toBe(400);
    expect((await page("dayan@dev", "m-maria", "?before=abc")).status).toBe(400);
    expect((await page("dayan@dev", "m-nadie")).status).toBe(404);
    expect((await page("dayan@dev", "m-dayan")).status).toBe(400);
  });
});

describe("evento conversation.updated", () => {
  const updates = (memberId: string, peer: string) =>
    f.userEvents(memberId).filter((e) => e.type === "conversation.updated" && e.memberId === peer).length;

  test("a las dos partes en cada cambio de estado; a nadie más", async () => {
    f = await setupAppFlow();
    const maria = await f.session("maria@dev", "backend-api", 200);
    const r = (await f.send("dayan@dev", { to: "m-maria", message: "hola" })).data;
    expect(updates("m-dayan", "m-maria")).toBeGreaterThan(0);
    expect(updates("m-maria", "m-dayan")).toBeGreaterThan(0);
    const before = [updates("m-dayan", "m-maria"), updates("m-maria", "m-dayan")];
    await f.call("maria@dev", "POST", `/api/v1/requests/${r.id}/forward`, { sessionId: maria.id });
    expect(updates("m-dayan", "m-maria")).toBeGreaterThan(before[0]!);
    expect(updates("m-maria", "m-dayan")).toBeGreaterThan(before[1]!);
    expect(f.userEvents("m-leo").some((e) => e.type === "conversation.updated")).toBe(false);
  });

  test("los borradores avisan a su autor (cambian lo que le espera)", async () => {
    f = await setupAppFlow();
    const dayan = await f.session("dayan@dev", "frontend", 100);
    const d = await draftFrom("dayan@dev", dayan.id, "m-maria", "hola");
    expect(updates("m-dayan", "m-maria")).toBe(1);
    expect(updates("m-maria", "m-dayan")).toBe(0); // un borrador aún no es de María
    await f.call("dayan@dev", "POST", `/api/v1/drafts/${d.id}/discard`);
    expect(updates("m-dayan", "m-maria")).toBe(2);
  });
});
