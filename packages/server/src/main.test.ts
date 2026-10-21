import { expect, test } from "bun:test";
import { rmSync } from "node:fs";
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
