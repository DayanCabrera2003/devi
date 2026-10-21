// Prueba de extremo a extremo de devi-update.sh: API de GitHub, descargas y /health falsos
// (Bun.serve en el puerto 0 y, para la salud por socket, en un socket Unix), systemctl
// sustituido por un stub que apunta las llamadas.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(import.meta.dir, "devi-update.sh");
const ASSET = "devi-x86_64-unknown-linux-gnu";

const fakeBinary = (version: string) => `#!/bin/sh\nif [ "$1" = "--version" ]; then echo ${version}; fi\n`;

let state: { tag: string; asset: string; sums: string; apiUp: boolean; healthy: boolean; downloads: number };
let server: ReturnType<typeof Bun.serve>;
let base: string;
let dir: string;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const path = new URL(req.url).pathname;
      if (path === "/repos/acme/devi/releases/latest") {
        if (!state.apiUp) return new Response("caído", { status: 503 });
        return Response.json({
          tag_name: state.tag,
          assets: [
            { name: "SHA256SUMS", browser_download_url: `${base}/dl/SHA256SUMS` },
            { name: ASSET, browser_download_url: `${base}/dl/${ASSET}` },
            { name: `${ASSET}.exe`, browser_download_url: `${base}/dl/otro` },
          ],
        });
      }
      if (path === `/dl/${ASSET}`) {
        state.downloads++;
        return new Response(state.asset);
      }
      if (path === "/dl/SHA256SUMS") return new Response(state.sums);
      if (path === "/api/v1/health") {
        return state.healthy ? Response.json({ ok: true, version: "x" }) : new Response("no", { status: 503 });
      }
      return new Response("404", { status: 404 });
    },
  });
  base = `http://127.0.0.1:${server.port}`;
});

afterAll(() => server.stop(true));

beforeEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = mkdtempSync(join(tmpdir(), "devi-update-"));
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin/devi"), fakeBinary("0.3.0"));
  chmodSync(join(dir, "bin/devi"), 0o755);
  writeFileSync(join(dir, "systemctl"), `#!/bin/sh\necho "$@" >> "${join(dir, "calls.log")}"\n`);
  chmodSync(join(dir, "systemctl"), 0o755);
  publish("v0.4.0", fakeBinary("0.4.0"));
  state.apiUp = true;
  state.healthy = true;
});

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function publish(tag: string, asset: string, sumsOverride?: string) {
  const sum = createHash("sha256").update(asset).digest("hex");
  state = {
    ...(state ?? { apiUp: true, healthy: true }),
    tag,
    asset,
    sums: sumsOverride ?? `${"0".repeat(64)}  devi-aarch64-unknown-linux-gnu\n${sum}  ${ASSET}\n`,
    downloads: 0,
  };
}

async function run(extraEnv: Record<string, string> = {}): Promise<{ code: number; out: string }> {
  const proc = Bun.spawn(["bash", SCRIPT], {
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      DEVI_REPO: "acme/devi",
      DEVI_BIN: join(dir, "bin/devi"),
      DEVI_OWNER: process.env.USER ?? "",
      DEVI_API: base,
      DEVI_SOCKET: "",
      DEVI_HEALTH: `${base}/api/v1/health`,
      SYSTEMCTL: join(dir, "systemctl"),
      HEALTH_TIMEOUT: "2",
      ...extraEnv,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { code, out: out + err };
}

const calls = () => (existsSync(join(dir, "calls.log")) ? readFileSync(join(dir, "calls.log"), "utf8").trim().split("\n") : []);
const installed = () => readFileSync(join(dir, "bin/devi"), "utf8");

test("al día: sin descarga ni reinicio", async () => {
  publish("v0.3.0", fakeBinary("0.3.0"));
  const r = await run();
  expect(r.code).toBe(0);
  expect(r.out).toContain("al día");
  expect(state.downloads).toBe(0);
  expect(calls()).toEqual([]);
});

test("versión nueva: instala, reinicia, sano, y guarda devi.prev", async () => {
  const r = await run();
  expect(r.code).toBe(0);
  expect(installed()).toBe(fakeBinary("0.4.0"));
  expect(readFileSync(join(dir, "bin/devi.prev"), "utf8")).toBe(fakeBinary("0.3.0"));
  expect(calls()).toEqual(["restart devi-server"]);
});

test("versión anterior publicada: también la instala (rollback)", async () => {
  publish("v0.2.0", fakeBinary("0.2.0"));
  const r = await run();
  expect(r.code).toBe(0);
  expect(installed()).toBe(fakeBinary("0.2.0"));
});

test("checksum incorrecto: aborta y no toca el binario", async () => {
  publish("v0.4.0", fakeBinary("0.4.0"), `${"a".repeat(64)}  ${ASSET}\n`);
  const r = await run();
  expect(r.code).toBe(1);
  expect(installed()).toBe(fakeBinary("0.3.0"));
  expect(existsSync(join(dir, "bin/devi.prev"))).toBe(false);
  expect(calls()).toEqual([]);
});

test("el binario descargado no da la versión de la etiqueta: aborta", async () => {
  publish("v0.4.0", fakeBinary("0.5.0"));
  const r = await run();
  expect(r.code).toBe(1);
  expect(installed()).toBe(fakeBinary("0.3.0"));
  expect(calls()).toEqual([]);
});

test("no arranca sano: vuelve al binario anterior y reinicia otra vez", async () => {
  state.healthy = false;
  const r = await run();
  expect(r.code).toBe(1);
  expect(installed()).toBe(fakeBinary("0.3.0"));
  expect(calls()).toEqual(["restart devi-server", "restart devi-server"]);
});

test("API caída: sale con 0 y no cambia nada", async () => {
  state.apiUp = false;
  const r = await run();
  expect(r.code).toBe(0);
  expect(installed()).toBe(fakeBinary("0.3.0"));
  expect(state.downloads).toBe(0);
  expect(calls()).toEqual([]);
});

test("no deja temporales junto al binario", async () => {
  expect((await run()).code).toBe(0);
  const entries = new Bun.Glob("bin/.devi-update.*").scanSync({ cwd: dir, dot: true, onlyFiles: false });
  expect([...entries].filter((e) => !e.endsWith(".lock"))).toEqual([]);
});

describe("salud por el socket Unix (como en producción)", () => {
  let sock: ReturnType<typeof Bun.serve> | null = null;
  const sockPath = () => join(dir, "devi.sock");
  const serveSocket = (healthy: boolean) => {
    sock = Bun.serve({
      unix: sockPath(),
      fetch: (req) =>
        new URL(req.url).pathname === "/api/v1/health" && healthy
          ? Response.json({ ok: true, version: "x" })
          : new Response("no", { status: 503 }),
    } as unknown as Parameters<typeof Bun.serve>[0]);
  };
  afterEach(() => {
    sock?.stop(true);
    sock = null;
  });
  // Sin DEVI_HEALTH: la URL por defecto (http://localhost/api/v1/health) va por DEVI_SOCKET.
  const viaSocket = () => ({ DEVI_SOCKET: sockPath(), DEVI_HEALTH: "" });

  test("sano por el socket: actualiza", async () => {
    serveSocket(true);
    const r = await run(viaSocket());
    expect(r.code).toBe(0);
    expect(r.out).toContain("actualizado a 0.4.0");
    expect(installed()).toBe(fakeBinary("0.4.0"));
  });

  test("el socket no responde sano: vuelve atrás", async () => {
    serveSocket(false);
    const r = await run(viaSocket());
    expect(r.code).toBe(1);
    expect(installed()).toBe(fakeBinary("0.3.0"));
    expect(calls()).toEqual(["restart devi-server", "restart devi-server"]);
  });
});
