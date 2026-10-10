// Verificación mecánica: actúa como Claude Code. Lanza el MCP de Devi por stdio,
// llama a sus herramientas y recibe los eventos de channel que empuja el hub.
// Requiere el hub corriendo (bun run hub).
// Uso: bun scripts/smoke-mcp.ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { join } from "node:path";
import { z } from "zod";

const HUB = process.env.DEVI_HUB_URL ?? "http://localhost:4747";
const MCP = join(import.meta.dir, "../src/mcp/devi-channel.ts");

const ChannelEvent = z.object({
  method: z.literal("notifications/claude/channel"),
  params: z.object({ content: z.string(), meta: z.record(z.string(), z.string()).optional() }),
});
export type ChannelEvent = z.infer<typeof ChannelEvent>["params"];

// Conecta un "Claude Code falso" como <user>/<session> y espera a que el hub registre la sesión.
export async function fakeClaude(user: string, session: string) {
  const events: ChannelEvent[] = [];
  const client = new Client({ name: "smoke", version: "0" });
  client.setNotificationHandler(ChannelEvent, async (n) => {
    events.push(n.params);
  });
  await client.connect(
    new StdioClientTransport({
      command: "bun",
      args: [MCP],
      env: { ...process.env, DEVI_USER: user, DEVI_SESSION: session, DEVI_HUB_URL: HUB } as Record<string, string>,
      stderr: "ignore",
    }),
  );
  const sessionId = await waitFor(async () => {
    const list = (await (await fetch(`${HUB}/api/users/${user}/sessions`)).json()) as { id: string; name: string }[];
    return list.find((s) => s.name === session)?.id;
  }, `sesión ${user}/${session} registrada`);
  const callTool = async (name: string, args: Record<string, unknown> = {}) => {
    const r = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
    return { text: r.content.map((c) => c.text).join("\n"), isError: !!r.isError };
  };
  const nextEvent = (pred: (e: ChannelEvent) => boolean, what: string) =>
    waitFor(async () => events.find(pred), what);
  return { client, sessionId, events, callTool, nextEvent, close: () => client.close() };
}

export async function waitFor<T>(fn: () => Promise<T | undefined>, what: string, ms = 5000): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v !== undefined) return v;
    await Bun.sleep(100);
  }
  throw new Error(`timeout esperando: ${what}`);
}

export function check(cond: unknown, msg: string) {
  if (!cond) {
    console.error(`✗ ${msg}`);
    process.exit(1);
  }
  console.log(`✓ ${msg}`);
}

if (import.meta.main) {
  const dayan = await fakeClaude("dayan", "frontend");
  check(dayan.sessionId, "el MCP registra la sesión dayan/frontend en el hub");

  const maria = await fakeClaude("maria", "backend-api");
  const teammates = await dayan.callTool("list_teammates");
  check(!teammates.isError && teammates.text.includes("maria"), "list_teammates muestra a maria (conectada)");
  check(!teammates.text.includes('"dayan"'), "list_teammates excluye al propio usuario");
  check(!teammates.text.includes('"leo"'), "list_teammates no muestra a leo (desconectado)");

  await fetch(`${HUB}/api/debug/push`, {
    method: "POST",
    body: JSON.stringify({ sessionId: dayan.sessionId, content: "hola desde Devi" }),
  });
  const ev = await dayan.nextEvent((e) => e.meta?.kind === "debug", "evento de channel");
  check(ev.content === "hola desde Devi", "el hub empuja un evento de channel a la sesión");

  await dayan.close();
  await maria.close();
  await Bun.sleep(300);
  const left = (await (await fetch(`${HUB}/api/users/dayan/sessions`)).json()) as unknown[];
  check(left.length === 0, "al cerrar la sesión, desaparece del hub");
  process.exit(0);
}
