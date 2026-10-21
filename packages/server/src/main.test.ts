import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { API_VERSION } from "@devi/protocol";
import { testConfig } from "./core/config";
import { startServer } from "./main";

test("startServer arranca en un puerto efímero y responde al health por el socket real", async () => {
  const cfg = testConfig();
  const { server } = await startServer(cfg, []);
  try {
    const res = await fetch(`http://127.0.0.1:${server.port}/api/v1/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, version: API_VERSION });
  } finally {
    server.stop(true);
    rmSync(cfg.dataDir, { recursive: true, force: true });
  }
});

test("con los módulos reales: sin admin no arranca; con --admin sí, y el admin entra", async () => {
  const cfg = testConfig();
  try {
    await expect(startServer(cfg)).rejects.toThrow("--admin");
    const { server, app } = await startServer({ ...cfg, adminLogin: "dayan@dev" });
    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/api/v1/me`, {
        headers: { "X-Devi-Version": API_VERSION, "X-Devi-Dev-User": "dayan@dev" },
      });
      expect(res.status).toBe(200);
      expect(((await res.json()) as { perms: string[] }).perms).toContain("team.admin");
    } finally {
      server.stop(true);
      app.stop();
    }
  } finally {
    rmSync(cfg.dataDir, { recursive: true, force: true });
  }
});

describe("--socket", () => {
  const sockDir = () => mkdtempSync(join(tmpdir(), "devi-sock-"));

  test("escucha en un socket Unix 0600 (crea el directorio) y responde por él", async () => {
    const dir = sockDir();
    const path = join(dir, "sub", "devi.sock");
    const cfg = testConfig({ socket: path });
    const { server, app } = await startServer(cfg, []);
    try {
      expect(statSync(path).isSocket()).toBe(true);
      expect(statSync(path).mode & 0o777).toBe(0o600);
      const res = await fetch("http://localhost/api/v1/health", { unix: path });
      expect(await res.json()).toEqual({ ok: true, version: API_VERSION });
    } finally {
      server.stop(true);
      app.stop();
      rmSync(dir, { recursive: true, force: true });
      rmSync(cfg.dataDir, { recursive: true, force: true });
    }
  });

  test("con los módulos reales y TailscaleServeIdentity: la identidad va por cabecera también por el socket", async () => {
    const dir = sockDir();
    const path = join(dir, "devi.sock");
    const cfg = testConfig({ socket: path, dev: false, adminLogin: "dayan@asai.digital" });
    const { server, app } = await startServer(cfg);
    try {
      const anon = await fetch("http://localhost/api/v1/me", { unix: path, headers: { "X-Devi-Version": API_VERSION } });
      expect(anon.status).toBe(401);
      const me = await fetch("http://localhost/api/v1/me", {
        unix: path,
        headers: { "X-Devi-Version": API_VERSION, "Tailscale-User-Login": "dayan@asai.digital" },
      });
      expect(me.status).toBe(200);
    } finally {
      server.stop(true);
      app.stop();
      rmSync(dir, { recursive: true, force: true });
      rmSync(cfg.dataDir, { recursive: true, force: true });
    }
  });

  test("borra un socket viejo antes de escuchar, pero nunca un archivo que no sea socket", async () => {
    const dir = sockDir();
    const path = join(dir, "devi.sock");
    // Socket huérfano (el que deja un servidor que se cayó): python lo crea y sale sin borrarlo.
    execFileSync("python3", ["-c", "import socket,sys; socket.socket(socket.AF_UNIX).bind(sys.argv[1])", path]);
    expect(statSync(path).isSocket()).toBe(true);
    const cfg = testConfig({ socket: path });
    const { server, app } = await startServer(cfg, []);
    server.stop(true);
    app.stop();

    const regular = join(dir, "no-socket");
    writeFileSync(regular, "datos");
    const bad = testConfig({ socket: regular });
    await expect(startServer(bad, [])).rejects.toThrow("no es un socket");
    rmSync(bad.dataDir, { recursive: true, force: true });
    expect(readFileSync(regular, "utf8")).toBe("datos");
    rmSync(dir, { recursive: true, force: true });
    rmSync(cfg.dataDir, { recursive: true, force: true });
  });
});
