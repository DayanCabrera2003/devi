import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { wrapUntrusted } from "@devi/protocol";
import { HOOK_DEADLINE_MS, INBOX_DEADLINE_MS, formatInboxContext, parseHookInput, runHook } from "./hook";

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
const sys = (url: string, env: Record<string, string> = {}) => ({
  platform: "linux" as const,
  env: { DEVI_CONFIG: "/no/existe.json", DEVI_SERVER_URL: url, DEVI_DEV_USER: "maria@dev", DEVI_MACHINE_ID: "M1", ...env },
  home: "/h",
});

test("parseHookInput", () => {
  expect(parseHookInput(INPUT)).toEqual({ claudeSessionId: "c1", cwd: "/p", eventName: "UserPromptSubmit", prompt: "hola" });
  expect(parseHookInput(JSON.stringify({ session_id: "c1", cwd: "/p" }))).toEqual({ claudeSessionId: "c1", cwd: "/p", eventName: null, prompt: null });
  expect(parseHookInput("no json")).toBeNull();
  expect(parseHookInput("{}")).toBeNull();
});

describe("runHook", () => {
  test("manda el estado con session_id, cwd, el pid del padre y la máquina", async () => {
    let body: unknown;
    let headers: Headers | undefined;
    const srv = serve(async (req) => {
      body = await req.json();
      headers = req.headers;
      return Response.json({ ok: true });
    });
    await runHook("working", sys(srv.url, { DEVI_CHANNEL: "1" }), stdin(INPUT));
    expect(body).toEqual({ claudeSessionId: "c1", cwd: "/p", parentPid: process.ppid, machine: "M1", status: "working" });
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

// Servidor falso con bandeja: GET /sessions/inbox, GET /files/:id, POST /sessions/inbox/ack.
function inboxServer(items: unknown[], files: Record<string, string> = {}) {
  const seen: { method: string; path: string; query: URLSearchParams; body?: unknown }[] = [];
  let pending = [...items] as { id: string }[];
  const srv = serve(async (req) => {
    const url = new URL(req.url);
    const body = req.method === "POST" ? await req.json() : undefined;
    seen.push({ method: req.method, path: url.pathname, query: url.searchParams, body });
    if (url.pathname === "/api/v1/sessions/inbox") return Response.json(pending);
    if (url.pathname === "/api/v1/sessions/inbox/ack") {
      const ids = (body as { ids: string[] }).ids;
      pending = pending.filter((i) => !ids.includes(i.id));
      return Response.json({ ok: true });
    }
    if (url.pathname.startsWith("/api/v1/files/")) return new Response(files[url.pathname.slice(14)] ?? "", { headers: { "Content-Type": "text/plain" } });
    return Response.json({ ok: true });
  });
  return { ...srv, seen };
}

const REQUEST_ITEM = {
  id: "i1", kind: "request", createdAt: 1,
  content: 'Dayan te pide desde su sesión "frontend" (solicitud q1): ¿me apruebas el PR?',
  meta: { request_id: "q1", from_name: "Dayan", inbox_id: "i1", files: JSON.stringify([{ id: "f1", name: "nota.txt" }]) },
};

describe("runHook sin canal: bandeja", () => {
  test("una entrega con un kind desconocido (servidor más nuevo) se salta: las demás llegan igual", async () => {
    const dir = mkdtempSync(join(tmpdir(), "devi-hook-"));
    const config = join(dir, "config.json");
    const future = { id: "i0", kind: "algo_futuro", createdAt: 1, content: "?", meta: { inbox_id: "i0" } };
    const srv = inboxServer([future, { ...REQUEST_ITEM, meta: { ...REQUEST_ITEM.meta, files: "[]" } }]);
    writeFileSync(config, JSON.stringify({ serverUrl: srv.url, devUser: "maria@dev", receivedDir: join(dir, "recibidos") }));
    const out: string[] = [];
    const s = { platform: "linux" as const, env: { DEVI_CONFIG: config, DEVI_MACHINE_ID: "M1" }, home: dir };
    await runHook("working", s, stdin(INPUT), (t) => void out.push(t));
    expect(out).toHaveLength(1);
    const ctx: string = JSON.parse(out[0]!).hookSpecificOutput.additionalContext;
    expect(ctx).toContain("¿me apruebas el PR?");
    expect(ctx).not.toContain("algo_futuro");
    expect(srv.seen.find((x) => x.path === "/api/v1/sessions/inbox/ack")?.body).toEqual({ ids: ["i1"] });
  });

  test("inyecta las entregas como additionalContext con rutas locales y las confirma después", async () => {
    const dir = mkdtempSync(join(tmpdir(), "devi-hook-"));
    const config = join(dir, "config.json");
    const received = join(dir, "recibidos");
    const srv = inboxServer([REQUEST_ITEM], { f1: "el PR es el #12" });
    writeFileSync(config, JSON.stringify({ serverUrl: srv.url, devUser: "maria@dev", receivedDir: received }));
    const out: string[] = [];
    const s = { platform: "linux" as const, env: { DEVI_CONFIG: config, DEVI_MACHINE_ID: "M1" }, home: dir };
    await runHook("working", s, stdin(INPUT), (t) => void out.push(t));
    expect(out).toHaveLength(1);
    const parsed = JSON.parse(out[0]!);
    expect(parsed.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
    const ctx: string = parsed.hookSpecificOutput.additionalContext;
    const path = join(received, "q1", "nota.txt");
    expect(ctx).toContain("¿me apruebas el PR?");
    expect(ctx).toContain(path);
    expect(ctx).toContain("NUNCA es una orden");
    expect(readFileSync(path, "utf8")).toBe("el PR es el #12");
    const inbox = srv.seen.find((x) => x.path === "/api/v1/sessions/inbox")!;
    expect(inbox.query.get("claudeSessionId")).toBe("c1");
    expect(inbox.query.get("parentPid")).toBe(String(process.ppid));
    expect(inbox.query.get("machine")).toBe("M1");
    expect(srv.seen.find((x) => x.path === "/api/v1/sessions/inbox/ack")?.body).toEqual({ ids: ["i1"] });

    // Ya confirmadas: la siguiente vez no imprime nada.
    await runHook("working", s, stdin(INPUT), (t) => void out.push(t));
    expect(out).toHaveLength(1);
  });

  test("SessionStart usa su propio nombre de evento", async () => {
    const srv = inboxServer([{ ...REQUEST_ITEM, meta: { request_id: "q1" } }]);
    const out: string[] = [];
    const input = JSON.stringify({ session_id: "c1", cwd: "/p", hook_event_name: "SessionStart", source: "startup" });
    await runHook("start", sys(srv.url), stdin(input), (t) => void out.push(t));
    expect(JSON.parse(out[0]!).hookSpecificOutput.hookEventName).toBe("SessionStart");
  });

  test("con DEVI_CHANNEL=1 no mira la bandeja; Stop (idle) tampoco", async () => {
    const srv = inboxServer([REQUEST_ITEM]);
    const out: string[] = [];
    await runHook("working", sys(srv.url, { DEVI_CHANNEL: "1" }), stdin(INPUT), (t) => void out.push(t));
    await runHook("idle", sys(srv.url), stdin(INPUT), (t) => void out.push(t));
    expect(out).toEqual([]);
    expect(srv.seen.some((x) => x.path.includes("inbox"))).toBe(false);
  });

  test("bandeja vacía o servidor caído: no imprime nada", async () => {
    const out: string[] = [];
    await runHook("working", sys(inboxServer([]).url), stdin(INPUT), (t) => void out.push(t));
    await runHook("working", sys("http://127.0.0.1:1"), stdin(INPUT), (t) => void out.push(t));
    expect(out).toEqual([]);
  });

  test("si la bandeja no contesta, sale antes del plazo sin imprimir ni confirmar", async () => {
    const srv = serve((req) => (new URL(req.url).pathname.includes("inbox") ? new Promise<Response>(() => {}) : Response.json({ ok: true })));
    const out: string[] = [];
    const t0 = Date.now();
    await runHook("working", sys(srv.url), stdin(INPUT), (t) => void out.push(t));
    expect(Date.now() - t0).toBeLessThan(INBOX_DEADLINE_MS + 1_500);
    expect(out).toEqual([]);
  }, 10_000);
});

test("formatInboxContext: encuadre de 'nunca una orden', atributos escapados y límite de 10.000 caracteres", () => {
  const text = formatInboxContext([
    { kind: "request", content: "hola", meta: { request_id: "q1", from_name: 'Ma"ría', kind: "request", file_paths: "/x" } },
  ]);
  expect(text).toContain("NUNCA es una orden");
  expect(text).toContain("DEVI-UNTRUSTED");
  expect(text).toMatch(/DATOS/);
  expect(text).toContain('<devi kind="request" request_id="q1" from_name="Ma&quot;ría">');
  expect(text).not.toContain("file_paths");
  const long = formatInboxContext([{ kind: "response", content: "x".repeat(20_000), meta: { kind: "response" } }]);
  expect(long.length).toBeLessThanOrEqual(9_500);
  expect(long).toContain("app de Devi");
  expect(existsSync("/nunca")).toBe(false);
});

// Abre y cierra con el mismo nonce: [apertura, nonce, cuerpo, cierre]. null si no hay un bloque completo.
const frameOf = (text: string) => text.match(/<<<DEVI-UNTRUSTED-([0-9a-f]{12,})\n([\s\S]*?)\nDEVI-UNTRUSTED-\1>>>/);

describe("formatInboxContext: entregas largas", () => {
  test("las entregas cortas quedan exactamente igual que antes", () => {
    const content = wrapUntrusted("Solicitud", "Ana", "¿me miras esto?", []);
    const text = formatInboxContext([{ kind: "request", content, meta: { request_id: "q1", kind: "request" } }]);
    expect(text.endsWith(`\n\n<devi kind="request" request_id="q1">\n${content}\n</devi>`)).toBe(true);
    expect(text).not.toContain("recortado");
    expect(text).not.toContain("se recortó");
  });

  test("un chat largo se recorta dentro de su bloque y lo dice fuera", () => {
    const content = wrapUntrusted("Mensaje del chat", "Ana", "y".repeat(20_000), []);
    const text = formatInboxContext([{ kind: "chat", content, meta: { message_id: "m1", kind: "chat" } }]);
    expect(text.length).toBeLessThanOrEqual(9_500);
    const frame = frameOf(text);
    expect(frame).not.toBeNull();
    expect(frame![2]).toContain("… [recortado]");
    const note = "Devi: el mensaje se recortó; el texto completo está en el chat de la app de Devi.";
    expect(text).toContain(note);
    expect(text.indexOf(note)).toBeGreaterThan(frame!.index! + frame![0].length);
  });

  test("varias entregas largas: se reparten el espacio y cada una conserva su cierre", () => {
    const a = wrapUntrusted("Solicitud", "Ana", "a".repeat(8_000), []);
    const b = wrapUntrusted("Respuesta", "Luis", "b".repeat(8_000), []);
    const short = wrapUntrusted("Solicitud", "Eva", "corto", []);
    const text = formatInboxContext([
      { kind: "request", content: a, meta: { request_id: "q1", kind: "request" } },
      { kind: "response", content: b, meta: { request_id: "q2", kind: "response" } },
      { kind: "request", content: short, meta: { request_id: "q3", kind: "request" } },
    ]);
    expect(text.length).toBeLessThanOrEqual(9_500);
    expect(text.match(/<<<DEVI-UNTRUSTED-[0-9a-f]+\n/g)).toHaveLength(3);
    expect(text.match(/\nDEVI-UNTRUSTED-[0-9a-f]+>>>/g)).toHaveLength(3);
    expect(text).toContain('get_request con request_id="q1"');
    expect(text).toContain('get_request con request_id="q2"');
    expect(text).not.toContain('request_id="q3" lo da');
    expect(text).toContain("corto\n");
    // Las dos largas se quedan con una parte parecida.
    const as = text.match(/a{100,}/)![0].length;
    const bs = text.match(/b{100,}/)![0].length;
    expect(Math.abs(as - bs)).toBeLessThan(50);
    expect(as).toBeGreaterThan(2_000);
  });

  test("sin bloque reconocible y sin sitio: se recorta como último recurso, sin pasarse", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ kind: "draft_discarded", content: "z".repeat(1_000), meta: { kind: "draft_discarded", n: String(i) } }));
    const text = formatInboxContext(many);
    expect(text.length).toBeLessThanOrEqual(9_500);
    expect(text).toContain("app de Devi");
  });
});

test("formatInboxContext: el aviso request_notice se ofrece con take_request / decline_request, sin actuar solo", () => {
  const text = formatInboxContext([{ kind: "request_notice", content: "aviso", meta: { request_id: "q1", kind: "request_notice" } }]);
  const start = text.indexOf('kind="request_notice"');
  expect(start).toBeGreaterThan(0);
  const line = text.slice(start, text.indexOf("\n- ", start));
  expect(line).toContain("take_request");
  expect(line).toContain("decline_request");
  expect(line).toMatch(/decid|decisión/);
});

// Servidor falso con canje y bandeja.
function claimServer(redeem: () => Response, inbox: unknown[] = []) {
  const seen: { path: string; body?: unknown }[] = [];
  const srv = serve(async (req) => {
    const url = new URL(req.url);
    const body = req.method === "POST" ? await req.json() : undefined;
    seen.push({ path: url.pathname, body });
    if (url.pathname === "/api/v1/claims/redeem") return redeem();
    if (url.pathname === "/api/v1/sessions/inbox") return Response.json(inbox);
    return Response.json({ ok: true });
  });
  return { ...srv, seen };
}
const claimInput = (prompt: string) => JSON.stringify({ session_id: "c1", cwd: "/p", hook_event_name: "UserPromptSubmit", prompt });
const DELIVERY = { kind: "request", content: "¿Revisas el PR?", meta: { request_id: "r1", inbox_id: "ib1" } };

describe("código de entrega", () => {
  test("con la frase: canjea, inyecta la entrega y la confirma (también con canal)", async () => {
    const srv = claimServer(() => Response.json({ delivery: DELIVERY }));
    let out = "";
    await runHook("working", sys(srv.url, { DEVI_CHANNEL: "1" }), stdin(claimInput("devi: recibir K7Q-4MX")), (t) => {
      out = t;
    });
    expect(srv.seen.find((s) => s.path === "/api/v1/claims/redeem")?.body).toMatchObject({ code: "K7Q4MX", claudeSessionId: "c1", machine: "M1" });
    const ctx = JSON.parse(out).hookSpecificOutput.additionalContext as string;
    expect(ctx).toContain("¿Revisas el PR?");
    expect(srv.seen.find((s) => s.path === "/api/v1/sessions/inbox/ack")?.body).toEqual({ ids: ["ib1"] });
  });

  test("sin canal no duplica lo que también está en la bandeja", async () => {
    const srv = claimServer(() => Response.json({ delivery: DELIVERY }), [{ id: "ib1", ...DELIVERY, createdAt: 1 }]);
    let out = "";
    await runHook("working", sys(srv.url), stdin(claimInput("devi: recibir K7Q-4MX")), (t) => {
      out = t;
    });
    const ctx = JSON.parse(out).hookSpecificOutput.additionalContext as string;
    expect(ctx.split("¿Revisas el PR?")).toHaveLength(2); // una sola vez
  });

  test("si el canje falla, inyecta la nota con el motivo", async () => {
    const srv = claimServer(() =>
      Response.json({ error: "Ese código caducó: genera otro en la app de Devi", code: "claim_expired" }, { status: 410 }),
    );
    let out = "";
    await runHook("working", sys(srv.url, { DEVI_CHANNEL: "1" }), stdin(claimInput("devi: recibir K7Q-4MX")), (t) => {
      out = t;
    });
    expect(JSON.parse(out).hookSpecificOutput.additionalContext).toContain("Ese código caducó");
  });

  test("con canal, el aviso no dice que falta el canal", async () => {
    const srv = claimServer(() => Response.json({ delivery: DELIVERY }));
    let out = "";
    await runHook("working", sys(srv.url, { DEVI_CHANNEL: "1" }), stdin(claimInput("devi: recibir K7Q-4MX")), (t) => {
      out = t;
    });
    const ctx = JSON.parse(out).hookSpecificOutput.additionalContext as string;
    expect(ctx).toContain("¿Revisas el PR?");
    expect(ctx).not.toContain("no tiene el canal");
  });

  test("con canal no pide la bandeja", async () => {
    const srv = claimServer(() => Response.json({ delivery: DELIVERY }));
    await runHook("working", sys(srv.url, { DEVI_CHANNEL: "1" }), stdin(claimInput("devi: recibir K7Q-4MX")), () => {});
    expect(srv.seen.some((s) => s.path === "/api/v1/claims/redeem")).toBe(true);
    expect(srv.seen.some((s) => s.path === "/api/v1/sessions/inbox")).toBe(false);
  });

  test("si los adjuntos no se pueden preparar, la entrega llega igual y lo dice fuera del bloque del compañero", async () => {
    // Un request_id que no vale como carpeta hace fallar la preparación de los archivos.
    const bad = { ...DELIVERY, meta: { request_id: "../r1", inbox_id: "ib1", files: JSON.stringify([{ id: "f1", name: "a.txt" }]) } };
    const srv = claimServer(() => Response.json({ delivery: bad }));
    let out = "";
    await runHook("working", sys(srv.url, { DEVI_CHANNEL: "1" }), stdin(claimInput("devi: recibir K7Q-4MX")), (t) => {
      out = t;
    });
    const ctx = JSON.parse(out).hookSpecificOutput.additionalContext as string;
    expect(ctx).toContain("¿Revisas el PR?");
    const note = "(Devi: los adjuntos no se pudieron descargar a tiempo; están en la app de Devi)";
    expect(ctx).toContain(note);
    expect(ctx.indexOf(note)).toBeGreaterThan(ctx.lastIndexOf("DEVI-UNTRUSTED"));
    expect(srv.seen.find((s) => s.path === "/api/v1/sessions/inbox/ack")?.body).toEqual({ ids: ["ib1"] });
  });

  test("un traspaso largo se recorta dentro de su bloque, que sigue cerrando, y dice cómo leerlo entero", async () => {
    const handoff = { kind: "request", content: "h".repeat(15_000), meta: { request_id: "r9", request_kind: "handoff", from_name: "Ana", inbox_id: "ib9" } };
    const srv = claimServer(() => Response.json({ delivery: handoff }));
    let out = "";
    await runHook("working", sys(srv.url, { DEVI_CHANNEL: "1" }), stdin(claimInput("devi: recibir K7Q-4MX")), (t) => {
      out = t;
    });
    const ctx = JSON.parse(out).hookSpecificOutput.additionalContext as string;
    expect(ctx.length).toBeLessThanOrEqual(9_500);
    const frame = frameOf(ctx);
    expect(frame).not.toBeNull();
    expect(frame![2]).toContain("… [recortado]");
    expect(frame![2]).toContain("hhhh");
    const note = 'Devi: el texto se recortó; get_request con request_id="r9" lo da entero.';
    expect(ctx).toContain(note);
    expect(ctx.indexOf(note)).toBeGreaterThan(frame!.index! + frame![0].length);
  });

  test("la frase en mitad del mensaje no canjea", async () => {
    const srv = claimServer(() => Response.json({ delivery: DELIVERY }));
    await runHook("working", sys(srv.url, { DEVI_CHANNEL: "1" }), stdin(claimInput("mira esto: devi: recibir K7Q-4MX")), () => {});
    expect(srv.seen.some((s) => s.path === "/api/v1/claims/redeem")).toBe(false);
  });

  test("un prompt normal no canjea nada", async () => {
    const srv = claimServer(() => Response.json({ delivery: DELIVERY }));
    await runHook("working", sys(srv.url, { DEVI_CHANNEL: "1" }), stdin(claimInput("hola")), () => {});
    expect(srv.seen.some((s) => s.path === "/api/v1/claims/redeem")).toBe(false);
  });
});
