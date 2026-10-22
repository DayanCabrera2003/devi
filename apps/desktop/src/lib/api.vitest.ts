import { afterEach, describe, expect, test, vi } from "vitest";
import { type ClientLike, DeviApi, classifyError, errorMessage } from "./api";

const fail = (status: number, body: Record<string, string>) => ({ status, body: { error: "mensaje", ...body } });

describe("classifyError", () => {
  test("pantallas especiales", () => {
    expect(classifyError(fail(403, { code: "unknown_login", login: "x@y" }))).toMatchObject({ kind: "unknown_login", login: "x@y" });
    expect(classifyError(fail(426, { code: "version", minVersion: "1.0.0" }))).toMatchObject({ kind: "update_required", minVersion: "1.0.0" });
    expect(classifyError(fail(403, { code: "origin" })).kind).toBe("origin");
    expect(classifyError(fail(401, { code: "no_identity" })).kind).toBe("no_identity");
  });

  test("permiso que falta con su etiqueta", () => {
    const e = classifyError(fail(403, { code: "missing_perm", perm: "files.send" }));
    expect(e).toMatchObject({ kind: "missing_perm", perm: "files.send" });
    expect(e.message).toContain("Enviar archivos");
  });

  test("conflicto, red y otros", () => {
    expect(classifyError(fail(409, {})).kind).toBe("conflict");
    expect(classifyError(new TypeError("Failed to fetch")).kind).toBe("network");
    // @devi/client lanza DeviApiError(0, { code: "unreachable" }) cuando no llega al servidor
    expect(classifyError(fail(0, { code: "unreachable" })).kind).toBe("network");
    expect(errorMessage("texto de Rust")).toBe("texto de Rust");
    expect(errorMessage(new Error("boom"))).toBe("boom");
  });
});

describe("DeviApi", () => {
  afterEach(() => vi.unstubAllGlobals());

  const fakeClient = () => {
    const call = vi.fn(async () => ({ ok: true }));
    const client: ClientLike = {
      call,
      downloadFile: vi.fn(async () => "contenido"),
      sendFromApp: vi.fn(async () => ({}) as never),
      conversations: vi.fn(async () => ({ items: [] })),
      conversation: vi.fn(async () => ({ requests: [] })),
      subscribeUser: vi.fn(() => () => {}),
    };
    return { client, call };
  };

  test("pasa params y body al cliente", async () => {
    const { client, call } = fakeClient();
    const api = new DeviApi(client, "https://pc.t.ts.net");
    await api.forwardRequest("q1", "s1");
    expect(call).toHaveBeenCalledWith("forwardRequest", { params: { id: "q1" }, body: { sessionId: "s1" } });
    await api.rejectRequest("q1", "no tengo acceso");
    expect(call).toHaveBeenLastCalledWith("rejectRequest", { params: { id: "q1" }, body: { reason: "no tengo acceso" } });
    await api.memberSessions("m1");
    expect(call).toHaveBeenLastCalledWith("memberSessions", { params: { id: "m1" } });
  });

  test("exportDb descarga bytes con la cabecera de versión", async () => {
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([1, 2, 3])));
    vi.stubGlobal("fetch", fetchMock);
    const api = new DeviApi(fakeClient().client, "http://127.0.0.1:4747", "dayan@dev");
    expect(Array.from(await api.exportDb())).toEqual([1, 2, 3]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe("http://127.0.0.1:4747/api/v1/settings/export");
    expect(init.headers).toMatchObject({ "X-Devi-Version": "1.0.0", "X-Devi-Dev-User": "dayan@dev" });
  });

  test("exportDb convierte el error del servidor", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "no", code: "missing_perm", perm: "team.admin" }, { status: 403 })));
    const api = new DeviApi(fakeClient().client, "https://pc.t.ts.net");
    await expect(api.exportDb()).rejects.toMatchObject({ status: 403 });
  });

  test("audit: llama a API.audit con limit y before en la query", async () => {
    const { client, call } = fakeClient();
    const page = { entries: [], nextBefore: 7 };
    call.mockResolvedValueOnce(page as never);
    const api = new DeviApi(client, "https://pc.t.ts.net");
    expect(await api.audit({ limit: 50, before: 123 })).toEqual(page);
    expect(call).toHaveBeenLastCalledWith("audit", { query: { limit: "50", before: "123" } });
    await api.audit({ limit: 20 });
    expect(call).toHaveBeenLastCalledWith("audit", { query: { limit: "20" } });
  });

  test("audit: AuditQuery rechaza un limit fuera de rango sin llamar al servidor", () => {
    const { client, call } = fakeClient();
    const api = new DeviApi(client, "https://pc.t.ts.net");
    expect(() => api.audit({ limit: 0 })).toThrow();
    expect(() => api.audit({ limit: 50, before: -1 })).toThrow();
    expect(call).not.toHaveBeenCalled();
  });
});
