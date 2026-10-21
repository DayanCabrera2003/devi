import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultReceivedDir } from "./paths";
import { ConfigError, loadClientConfig } from "./config";

const dir = mkdtempSync(join(tmpdir(), "devi-config-"));
afterEach(() => rmSync(join(dir, "c.json"), { force: true }));
const sys = (env: Record<string, string> = {}) => ({ platform: "linux" as const, env: { DEVI_CONFIG: join(dir, "c.json"), ...env }, home: "/home/a" });

describe("loadClientConfig", () => {
  test("lee serverUrl y devUser; ignora claves desconocidas", async () => {
    writeFileSync(join(dir, "c.json"), JSON.stringify({ serverUrl: "https://pc.tail.ts.net", devUser: "maria@dev", theme: "dark" }));
    expect(await loadClientConfig(sys())).toEqual({
      serverUrl: "https://pc.tail.ts.net", devUser: "maria@dev", receivedDir: "/home/a/Devi/recibidos", path: join(dir, "c.json"),
    });
  });

  test("acepta y ignora claves desconocidas (la app guarda las suyas bajo `app`)", async () => {
    writeFileSync(join(dir, "c.json"), JSON.stringify({ serverUrl: "https://pc.tail.ts.net", app: { theme: "dark", nested: { a: 1 } }, other: 1 }));
    expect(await loadClientConfig(sys())).toEqual({
      serverUrl: "https://pc.tail.ts.net", devUser: undefined, receivedDir: "/home/a/Devi/recibidos", path: join(dir, "c.json"),
    });
  });

  test("receivedDir del fichero", async () => {
    writeFileSync(join(dir, "c.json"), JSON.stringify({ serverUrl: "https://pc.tail.ts.net", receivedDir: "/r" }));
    expect((await loadClientConfig(sys())).receivedDir).toBe("/r");
  });

  test("las variables de entorno mandan sobre el fichero", async () => {
    writeFileSync(join(dir, "c.json"), JSON.stringify({ serverUrl: "https://pc.tail.ts.net" }));
    const c = await loadClientConfig(sys({ DEVI_SERVER_URL: "http://127.0.0.1:4848", DEVI_DEV_USER: "x@dev" }));
    expect(c.serverUrl).toBe("http://127.0.0.1:4848");
    expect(c.devUser).toBe("x@dev");
  });

  test("sin fichero ni entorno → ConfigError legible", async () => {
    expect(loadClientConfig(sys())).rejects.toThrow(ConfigError);
    expect(loadClientConfig(sys())).rejects.toThrow(/Abre la app de Devi/);
  });

  test("serverUrl vacío (o solo espacios) o ausente cuenta como falta: mensaje amable", async () => {
    for (const cfg of [{ serverUrl: "" }, { serverUrl: "   " }, { devUser: "maria@dev" }]) {
      writeFileSync(join(dir, "c.json"), JSON.stringify(cfg));
      await expect(loadClientConfig(sys())).rejects.toThrow(/falta la URL del servidor.*Abre la app de Devi/);
    }
  });

  test("serverUrl vacío en el fichero: DEVI_SERVER_URL lo sustituye", async () => {
    writeFileSync(join(dir, "c.json"), JSON.stringify({ serverUrl: "", devUser: "maria@dev" }));
    const c = await loadClientConfig(sys({ DEVI_SERVER_URL: "http://127.0.0.1:4848" }));
    expect(c).toMatchObject({ serverUrl: "http://127.0.0.1:4848", devUser: "maria@dev" });
  });

  test("JSON roto o URL inválida → ConfigError", async () => {
    writeFileSync(join(dir, "c.json"), "{");
    expect(loadClientConfig(sys())).rejects.toThrow(/no es JSON válido/);
    writeFileSync(join(dir, "c.json"), JSON.stringify({ serverUrl: "no es url" }));
    expect(loadClientConfig(sys())).rejects.toThrow(/serverUrl/);
  });

  test("receivedDir relativo: se ignora con aviso en stderr y se usa el de por defecto", async () => {
    writeFileSync(join(dir, "c.json"), JSON.stringify({ serverUrl: "https://pc.tail.ts.net", receivedDir: "recibidos" }));
    const spy = spyOn(console, "error").mockImplementation(() => {});
    try {
      expect((await loadClientConfig(sys())).receivedDir).toBe(defaultReceivedDir(sys()));
      expect(spy).toHaveBeenCalledTimes(1);
      expect(String(spy.mock.calls[0]![0])).toContain("receivedDir");
    } finally {
      spy.mockRestore();
    }
  });
});
