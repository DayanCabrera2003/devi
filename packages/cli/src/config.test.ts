import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

  test("JSON roto o URL inválida → ConfigError", async () => {
    writeFileSync(join(dir, "c.json"), "{");
    expect(loadClientConfig(sys())).rejects.toThrow(/no es JSON válido/);
    writeFileSync(join(dir, "c.json"), JSON.stringify({ serverUrl: "no es url" }));
    expect(loadClientConfig(sys())).rejects.toThrow(/serverUrl/);
  });
});
