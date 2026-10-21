import { afterEach, describe, expect, test } from "bun:test";
import { HOOK_DEADLINE_MS, parseHookInput, runHook } from "./hook";

const stdin = (s: string) => async () => s;
const INPUT = JSON.stringify({ session_id: "c1", cwd: "/p", hook_event_name: "UserPromptSubmit", prompt: "hola" });

let servers: { stop: (force?: boolean) => void }[] = [];
afterEach(() => {
  for (const s of servers) s.stop(true);
  servers = [];
});
function serve(handler: (req: Request) => Response | Promise<Response>) {
  const s = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: handler });
  servers.push(s);
  return { url: `http://127.0.0.1:${s.port}` };
}
const sys = (url: string) => ({ platform: "linux" as const, env: { DEVI_CONFIG: "/no/existe.json", DEVI_SERVER_URL: url, DEVI_DEV_USER: "maria@dev" }, home: "/h" });

test("parseHookInput", () => {
  expect(parseHookInput(INPUT)).toEqual({ claudeSessionId: "c1", cwd: "/p" });
  expect(parseHookInput("no json")).toBeNull();
  expect(parseHookInput("{}")).toBeNull();
});

describe("runHook", () => {
  test("manda el estado con session_id, cwd y el pid del padre", async () => {
    let body: unknown;
    let headers: Headers | undefined;
    const srv = serve(async (req) => {
      body = await req.json();
      headers = req.headers;
      return Response.json({ ok: true });
    });
    await runHook("working", sys(srv.url), stdin(INPUT));
    expect(body).toEqual({ claudeSessionId: "c1", cwd: "/p", parentPid: process.ppid, status: "working" });
    expect(headers?.get("X-Devi-Dev-User")).toBe("maria@dev");
  });

  test("no tarda más de 1 s aunque el servidor no conteste", async () => {
    const srv = serve(() => new Promise<Response>(() => {}));
    const t0 = Date.now();
    await runHook("idle", sys(srv.url), stdin(INPUT));
    expect(Date.now() - t0).toBeLessThan(HOOK_DEADLINE_MS + 300);
  });

  test("no lanza sin servidor, sin config ni con stdin basura", async () => {
    await runHook("idle", sys("http://127.0.0.1:1"), stdin(INPUT));
    await runHook("idle", { platform: "linux", env: { DEVI_CONFIG: "/no/existe.json" }, home: "/h" }, stdin(INPUT));
    await runHook("idle", sys("http://127.0.0.1:1"), stdin("basura"));
    await runHook(null, sys("http://127.0.0.1:1"), stdin(INPUT));
  });
});
