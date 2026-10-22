import { expect, test } from "bun:test";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const MAIN = join(import.meta.dir, "../main.ts");

// Lanza `devi mcp` por stdio como haría Claude Code (sin servidor de Devi detrás).
async function connect(env: Record<string, string>) {
  const client = new Client({ name: "test", version: "0" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [MAIN, "mcp"],
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "/tmp", DEVI_CONFIG: "/no/existe/config.json", DEVI_MACHINE_ID: "maquina-test", ...env },
      stderr: "ignore",
    }),
  );
  const call = async (name: string, args: Record<string, unknown> = {}) =>
    (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError: boolean };
  return { client, call };
}

test("devi mcp por stdio: instrucciones, herramientas y error legible sin configuración", async () => {
  const { client, call } = await connect({ DEVI_SESSION: "prueba" });
  expect(client.getInstructions()).toContain('Esta sesión se llama "prueba"');
  expect(client.getInstructions()).toContain("aviso de permisos de Claude Code");
  const tools = (await client.listTools()).tools;
  expect(tools.map((t) => t.name)).toEqual(["list_teammates", "send_request", "respond_to_request"]);
  // El SDK deja pasar _meta hasta el cliente: Claude Code lo lee para pedir aprobación en cada llamada.
  for (const t of tools.slice(1)) expect(t._meta).toEqual({ "anthropic/requiresUserInteraction": true });
  const r = await call("list_teammates");
  expect(r.isError).toBe(true);
  expect(r.content[0]!.text).toContain("Devi no está configurado");
  await client.close();
}, 15_000);

test("devi mcp con el servidor caído: las herramientas lo explican", async () => {
  const { client, call } = await connect({ DEVI_SERVER_URL: "http://127.0.0.1:9" });
  const r = await call("list_teammates");
  expect(r.isError).toBe(true);
  expect(r.content[0]!.text).toContain("No se pudo conectar con el servidor de Devi");
  await client.close();
}, 15_000);
