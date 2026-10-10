// Verificación mecánica del slice 4: timeout, reenviar/ignorar, tarjetas al reconectar
// y herramientas con el hub caído. Requiere un hub con DEVI_TIMEOUT_MS corto (p. ej. 1500).
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { join } from "node:path";
import { setupTwo, fakeWindow, post } from "./smoke-flow";
import { check } from "./smoke-mcp";

const { winDayan, winMaria, dayan, maria } = await setupTwo();

const sent = await dayan.callTool("send_request", { to: "maria", message: "¿Revisas el deploy de staging?" });
const id = sent.text.match(/Solicitud (\w+)/)![1]!;
await winMaria.next((c) => c.event === "card" && c.data.request.id === id, "tarjeta en María");

// Una ventana nueva (recarga) recibe la tarjeta que sigue abierta.
const reloaded = await fakeWindow("maria");
await reloaded.next((c) => c.event === "card" && c.data.request.id === id, "tarjeta reenviada al reconectar");
check(true, "al recargar la ventana vuelve la tarjeta pendiente");
reloaded.close();

// Nadie actúa: vence.
const to = await winDayan.next((c) => c.event === "card" && c.data.type === "timeout", "tarjeta de timeout", 6000);
check(to.data.request.id === id, "A recibe 'Sin respuesta' al vencer el plazo");
await winMaria.next((c) => c.event === "resolved" && c.data.id === id, "tarjeta retirada en María");
check(true, "a B se le retira la tarjeta vencida");

// Reenviar → vuelve a B.
const before = winMaria.events.length;
check((await post(`/api/requests/${id}/resend`, {})).status === 200, "Reenviar");
await winMaria.next((c) => winMaria.events.indexOf(c) >= before && c.event === "card" && c.data.request.id === id, "tarjeta reenviada");
check(true, "la solicitud reenviada vuelve a la ventana de B");

// Vence otra vez → Ignorar la cierra.
const n = winDayan.events.filter((c) => c.data.type === "timeout").length;
await winDayan.next(() => winDayan.events.filter((c) => c.data.type === "timeout").length > n, "segundo timeout", 6000);
check((await post(`/api/requests/${id}/ignore`, {})).status === 200, "Ignorar cierra la solicitud");
check((await post(`/api/requests/${id}/ignore`, {})).status === 409, "ignorar dos veces → 409");

// Herramientas del MCP con el hub caído.
const client = new Client({ name: "smoke", version: "0" });
await client.connect(new StdioClientTransport({
  command: "bun",
  args: [join(import.meta.dir, "../src/mcp/devi-channel.ts")],
  env: { ...process.env, DEVI_USER: "dayan", DEVI_SESSION: "x", DEVI_HUB_URL: "http://localhost:1" } as Record<string, string>,
  stderr: "ignore",
}));
const r = (await client.callTool({ name: "list_teammates", arguments: {} })) as any;
check(r.isError && r.content[0].text.includes("Devi Hub no está corriendo"), "con el hub caído, las herramientas lo dicen claramente");
await client.close();

await Promise.all([dayan.close(), maria.close()]);
winDayan.close();
winMaria.close();
process.exit(0);
