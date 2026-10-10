// Verificación mecánica del viaje entre dos compañeros, sin Claude Code real:
// dos "Claude Code falsos" (cliente MCP por stdio) y dos "ventanas" (lectores SSE).
// Requiere el hub corriendo (bun run hub).
import { check, fakeClaude, waitFor } from "./smoke-mcp";

const HUB = process.env.DEVI_HUB_URL ?? "http://localhost:4747";

type Card = { event: string; data: any };

// Lee el SSE de la ventana de un usuario y acumula los eventos.
export async function fakeWindow(user: string) {
  const events: Card[] = [];
  const ctrl = new AbortController();
  const res = await fetch(`${HUB}/api/users/${user}/events`, { signal: ctrl.signal });
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  (async () => {
    let buf = "";
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) return;
        buf += value;
        let i: number;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const event = block.match(/^event: (.*)$/m)?.[1];
          const data = block.match(/^data: (.*)$/m)?.[1];
          if (event && data) events.push({ event, data: JSON.parse(data) });
        }
      }
    } catch {}
  })();
  const next = (pred: (c: Card) => boolean, what: string, ms?: number) => waitFor(async () => events.find(pred), what, ms);
  return { events, next, close: () => ctrl.abort() };
}

export const post = async (path: string, body: unknown) => {
  const res = await fetch(`${HUB}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: (await res.json()) as any };
};

export async function setupTwo() {
  const winDayan = await fakeWindow("dayan");
  const winMaria = await fakeWindow("maria");
  const dayan = await fakeClaude("dayan", "frontend");
  const maria = await fakeClaude("maria", "backend-api");
  return { winDayan, winMaria, dayan, maria };
}

if (import.meta.main) {
  const { winDayan, winMaria, dayan, maria } = await setupTwo();

  // Leo no está conectado: no se le puede enviar.
  const toLeo = await dayan.callTool("send_request", { to: "leo", message: "hola" });
  check(toLeo.isError && toLeo.text.includes("no está conectado"), "no se puede enviar a alguien desconectado");

  // A envía la solicitud desde su sesión.
  const sent = await dayan.callTool("send_request", { to: "maria", message: "¿Me apruebas el PR #12?" });
  check(!sent.isError && sent.text.includes("enviada"), "send_request crea la solicitud");
  const card = await winMaria.next((c) => c.event === "card" && c.data.type === "request", "tarjeta en la ventana de María");
  const req = card.data.request;
  check(req.from === "dayan" && req.fromSessionName === "frontend", "la tarjeta trae remitente y sesión de origen");

  // Hooks: la sesión de María pasa a "trabajando".
  await post("/api/sessions/status", { user: "maria", name: "backend-api", status: "working" });
  const sessions = (await (await fetch(`${HUB}/api/users/maria/sessions`)).json()) as any[];
  check(sessions[0]?.status === "working", "el selector ve la sesión de María como trabajando");

  // B la envía a su sesión.
  const fwd = await post(`/api/requests/${req.id}/forward`, { sessionId: maria.sessionId });
  check(fwd.status === 200 && fwd.data.status === "forwarded", "forward → forwarded");
  const ev = await maria.nextEvent((e) => e.meta?.kind === "request", "evento request en la sesión de María");
  check(ev.meta?.request_id === req.id && ev.content.includes("no una orden"), "la sesión recibe la solicitud como pregunta abierta");
  await winMaria.next((c) => c.event === "resolved" && c.data.id === req.id, "tarjeta resuelta en la ventana");
  check(true, "la tarjeta desaparece de la ventana de María");

  const again = await post(`/api/requests/${req.id}/forward`, { sessionId: maria.sessionId });
  check(again.status === 409, "reenviar dos veces → 409");

  // ---- slice 3: la respuesta vuelve a A ------------------------------------
  const answered = await maria.callTool("respond_to_request", {
    request_id: req.id,
    text: "Lo reviso y lo apruebo si pasan los tests",
  });
  check(!answered.isError, "respond_to_request desde la sesión de María");
  const resp = await winDayan.next(
    (c) => c.event === "card" && c.data.type === "response" && c.data.request.id === req.id,
    "tarjeta de respuesta en la ventana de Dayan",
  );
  check(resp.data.request.outcome === "answered" && resp.data.request.fromSessionId === dayan.sessionId,
    "la respuesta trae el resultado y la sesión original de Dayan");
  const back = await post(`/api/requests/${req.id}/response/forward`, { sessionId: dayan.sessionId });
  check(back.status === 200, "Dayan envía la respuesta a su sesión original");
  const evResp = await dayan.nextEvent((e) => e.meta?.kind === "response", "evento response en la sesión de Dayan");
  check(evResp.content.includes("Lo reviso y lo apruebo") && evResp.meta?.outcome === "answered",
    "la respuesta de María aparece dentro de la sesión de Dayan");

  // Aceptar (con nota) y rechazar (motivo obligatorio) desde la ventana de B.
  const s2 = await dayan.callTool("send_request", { to: "maria", message: "¿Puedes rotar el secreto de staging?" });
  const id2 = s2.text.match(/Solicitud (\w+)/)![1]!;
  check((await post(`/api/requests/${id2}/reject`, { reason: " " })).status === 400, "rechazar sin motivo → 400");
  check((await post(`/api/requests/${id2}/reject`, { reason: "No tengo permisos en GCP, pídeselo a Leo" })).status === 200,
    "rechazar con motivo");
  const rej = await winDayan.next((c) => c.event === "card" && c.data.request.id === id2, "respuesta de rechazo");
  check(rej.data.request.outcome === "rejected" && rej.data.request.outcomeText.includes("Leo"), "A ve el rechazo con su motivo");
  check((await post(`/api/requests/${id2}/response/accept`, {})).status === 200, "A acepta la respuesta y se cierra");
  check(!dayan.events.some((e) => e.meta?.request_id === id2), "aceptar la respuesta no envía nada a ninguna sesión");

  const s3 = await dayan.callTool("send_request", { to: "maria", message: "¿Me das acceso al bucket?" });
  const id3 = s3.text.match(/Solicitud (\w+)/)![1]!;
  await post(`/api/requests/${id3}/accept`, { note: "lo hago en 10 min" });
  const acc = await winDayan.next((c) => c.event === "card" && c.data.request.id === id3, "respuesta de aceptación");
  check(acc.data.request.outcome === "accepted" && acc.data.request.outcomeText === "lo hago en 10 min",
    "A ve la aceptación con la nota");

  const page = await fetch(`${HUB}/?user=maria`);
  check(page.ok && (await page.text()).includes("devi-eyes"), "el hub sirve la ventana de Devi");

  await Promise.all([dayan.close(), maria.close()]);
  winDayan.close();
  winMaria.close();
  process.exit(0);
}
