// Ventana de Devi: escucha las tarjetas del hub (SSE) y permite actuar sobre ellas.

const user = new URLSearchParams(location.search).get("user");
const $ = (sel) => document.querySelector(sel);
const devi = $("#devi");

let team = [];
const nameOf = (id) => team.find((m) => m.id === id)?.name ?? id;

// Tarjetas abiertas, en orden de llegada. Clave: "<tipo>:<id de solicitud>".
const cards = new Map();
// Estado de UI de la tarjeta actual (p. ej. "eligiendo sesión").
let mode = null;

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (v !== false && v != null) el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c);
  return el;
}

async function api(path, body) {
  const res = await fetch(path, body === undefined ? {} : {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `error ${res.status}`);
  return data;
}

// ---- Devi y avisos -------------------------------------------------------------

function poke() {
  devi.classList.remove("bounce");
  void devi.getBoundingClientRect();
  devi.classList.add("bounce");
}

function notify(title, body) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const n = new Notification(title, { body, tag: title, icon: $("link[rel=icon]").href });
  n.onclick = () => { window.focus(); n.close(); };
}

function setupNotifButton() {
  const btn = $("#notif-btn");
  if (!("Notification" in window) || Notification.permission !== "default") return;
  btn.hidden = false;
  btn.onclick = async () => {
    await Notification.requestPermission();
    btn.hidden = Notification.permission !== "default";
  };
}

// ---- render --------------------------------------------------------------------

function render() {
  const list = [...cards.values()];
  const current = $("#current");
  const queue = $("#queue");
  current.replaceChildren();
  queue.replaceChildren();
  devi.classList.toggle("look", list.length > 0);

  if (list.length === 0) {
    mode = null;
    current.append(h("div", { class: "empty" }, "Todo tranquilo. Te aviso cuando alguien te necesite."));
    return;
  }
  const [first, ...rest] = list;
  current.append(renderCard(first));
  for (const c of rest) {
    queue.append(h("div", { class: "card" }, `${kicker(c)} · ${nameOf(c.request.from === user ? c.request.to : c.request.from)}`));
  }
}

const kicker = (c) => ({ request: "Solicitud", response: "Respuesta", timeout: "Sin respuesta" })[c.type];

function renderCard(c) {
  if (c.type === "request") {
    if (mode === "pick-session") return renderPicker(c);
    if (mode === "accept" || mode === "reject") return renderDecision(c, mode);
    return renderRequest(c);
  }
  if (c.type === "response") return mode === "pick-session" ? renderResponsePicker(c) : renderResponse(c);
  return renderTimeout(c);
}

// Nadie actuó a tiempo: A decide si reenviar o ignorar.
function renderTimeout(c) {
  const r = c.request;
  const error = h("div", { class: "error" });
  const act = (what) => async () => {
    try { await api(`/api/requests/${r.id}/${what}`, {}); } catch (e) { error.textContent = e.message; }
  };
  return h("div", { class: "card" },
    h("div", { class: "card-kicker" }, "Sin respuesta"),
    h("div", { class: "card-title" }, `${nameOf(r.to)} no respondió a tiempo`),
    h("div", { class: "card-from" }, `Pasó ${waited(r)} sin que nadie actuara.`),
    h("p", { class: "card-msg" }, r.message),
    h("div", { class: "actions" },
      h("button", { class: "primary", onclick: act("resend") }, "Reenviar"),
      h("button", { onclick: act("ignore") }, "Ignorar"),
    ),
    error,
  );
}

function waited(r) {
  const min = Math.round((r.deadline - r.sentAt) / 60000);
  if (min >= 60) return `${Math.round(min / 60)} h`;
  if (min >= 1) return `${min} min`;
  return `${Math.round((r.deadline - r.sentAt) / 1000)} s`;
}

const go = (m) => () => { mode = m; render(); };

function renderRequest(c) {
  const r = c.request;
  return h("div", { class: "card" },
    h("div", { class: "card-kicker" }, "Solicitud"),
    h("div", { class: "card-title" }, `${nameOf(r.from)} te pide algo`),
    h("div", { class: "card-from" }, "desde la sesión ", h("span", { class: "mono" }, r.fromSessionName)),
    h("p", { class: "card-msg" }, r.message),
    h("div", { class: "actions" },
      h("button", { class: "primary", onclick: go("pick-session") }, "Enviar a sesión"),
      h("button", { class: "ok", onclick: go("accept") }, "Aceptar"),
      h("button", { class: "no", onclick: go("reject") }, "Rechazar"),
    ),
  );
}

// Aceptar (nota opcional) o Rechazar (motivo obligatorio).
function renderDecision(c, kind) {
  const r = c.request;
  const accept = kind === "accept";
  const error = h("div", { class: "error" });
  const input = h("textarea", {
    placeholder: accept ? "Nota opcional: \"lo hago en 10 min\"" : `Explícale a ${nameOf(r.from)} por qué`,
    oninput: () => { confirm.disabled = !accept && !input.value.trim(); },
  });
  const confirm = h("button", {
    class: accept ? "ok" : "no",
    disabled: !accept,
    onclick: async () => {
      confirm.disabled = true;
      try {
        await api(`/api/requests/${r.id}/${kind}`, accept ? { note: input.value } : { reason: input.value });
      } catch (e) {
        error.textContent = e.message;
        confirm.disabled = false;
      }
    },
  }, accept ? "Confirmar: lo hago yo" : "Confirmar rechazo");
  setTimeout(() => input.focus());
  return h("div", { class: "card" },
    h("div", { class: "card-kicker" }, accept ? "Aceptar" : "Rechazar"),
    h("div", { class: "card-title" }, accept ? "Lo harás tú" : `Rechazar la solicitud de ${nameOf(r.from)}`),
    h("div", { class: "card-from" }, accept
      ? "Para lo que el agente no puede hacer (GCP, GitHub…)."
      : "El motivo es obligatorio: le llegará con el rechazo."),
    h("p", { class: "card-msg" }, r.message),
    input,
    h("div", { class: "actions" }, confirm, h("button", { onclick: go(null) }, "Volver")),
    error,
  );
}

const OUTCOME = {
  accepted: ["Aceptada", "ok", "Lo hará personalmente."],
  rejected: ["Rechazada", "no", "Motivo:"],
  answered: ["Respondida", "", "Desde su sesión de Claude Code:"],
};

// Respuesta en la ventana de A: Aceptar (cierra) o Enviar a sesión.
function renderResponse(c) {
  const r = c.request;
  const [label, cls, lead] = OUTCOME[r.outcome] ?? ["Respuesta", "", ""];
  const error = h("div", { class: "error" });
  const toSession = h("button", { class: "primary", hidden: true, onclick: go("pick-session") }, "Enviar a sesión");
  // Solo se ofrece "Enviar a sesión" si A tiene alguna sesión abierta.
  api(`/api/users/${user}/sessions`).then((s) => { toSession.hidden = s.length === 0; }).catch(() => {});
  return h("div", { class: "card" },
    h("div", { class: "card-kicker" }, "Respuesta · ", h("span", { class: cls ? `badge ${cls}` : "badge" }, label)),
    h("div", { class: "card-title" }, `Respuesta de ${nameOf(r.to)}`),
    h("div", { class: "card-from" }, "a: ", h("span", { class: "muted" }, `“${r.message}”`)),
    r.outcomeText ? h("p", { class: "card-msg" }, h("span", { class: "muted" }, lead + " "), r.outcomeText)
                  : h("p", { class: "card-msg" }, h("span", { class: "muted" }, lead)),
    h("div", { class: "actions" },
      toSession,
      h("button", {
        class: "ok",
        onclick: async () => {
          try { await api(`/api/requests/${r.id}/response/accept`, {}); } catch (e) { error.textContent = e.message; }
        },
      }, "Aceptar"),
    ),
    error,
  );
}

function renderResponsePicker(c) {
  const r = c.request;
  const box = h("div", { class: "sessions" }, h("div", { class: "muted" }, "Buscando tus sesiones…"));
  const error = h("div", { class: "error" });
  loadSessions(box, error, (s) => api(`/api/requests/${r.id}/response/forward`, { sessionId: s.id }), r.fromSessionId);
  return h("div", { class: "card" },
    h("div", { class: "card-kicker" }, "Enviar a sesión"),
    h("div", { class: "card-title" }, "¿A qué sesión se la pasas?"),
    h("div", { class: "card-from" }, "Resaltada: la sesión que hizo la solicitud, si sigue abierta."),
    box,
    h("div", { class: "actions" }, h("button", { onclick: go(null) }, "Volver")),
    error,
  );
}

// Selector de sesiones de Claude Code del usuario actual.
function renderPicker(c) {
  const box = h("div", { class: "sessions" }, h("div", { class: "muted" }, "Buscando tus sesiones…"));
  const error = h("div", { class: "error" });
  const card = h("div", { class: "card" },
    h("div", { class: "card-kicker" }, "Enviar a sesión"),
    h("div", { class: "card-title" }, "¿A qué sesión se lo pasas?"),
    h("div", { class: "card-from" }, "Llegará como pregunta abierta, no como orden."),
    box,
    h("div", { class: "actions" }, h("button", { onclick: go(null) }, "Volver")),
    error,
  );
  loadSessions(box, error, async (s) => {
    await api(`/api/requests/${c.request.id}/forward`, { sessionId: s.id });
  });
  return card;
}

async function loadSessions(box, error, onPick, preferredId) {
  try {
    const sessions = await api(`/api/users/${user}/sessions`);
    box.replaceChildren();
    if (sessions.length === 0) {
      box.append(h("div", { class: "muted" }, "No tienes sesiones de Claude Code abiertas con Devi."));
      return;
    }
    sessions.sort((a, b) => (b.id === preferredId) - (a.id === preferredId));
    for (const s of sessions) {
      box.append(h("button", {
        class: `session${s.id === preferredId ? " preferred" : ""}`,
        onclick: async () => {
          try {
            await onPick(s);
          } catch (e) {
            error.textContent = e.message;
            loadSessions(box, error, onPick, preferredId);
          }
        },
      },
        h("span", { class: `dot ${s.status === "working" ? "busy" : "on"}` }),
        h("span", { class: "mono" }, s.name),
        h("span", { class: "state" }, s.status === "working" ? "trabajando" : "libre"),
      ));
    }
  } catch (e) {
    error.textContent = e.message;
  }
}

// ---- conexión ------------------------------------------------------------------

function connect() {
  const es = new EventSource(`/api/users/${encodeURIComponent(user)}/events`);
  es.onopen = () => {
    // El hub reenvía las tarjetas abiertas al conectar: partimos de cero para no mostrar resueltas.
    cards.clear();
    mode = null;
    render();
    $("#conn").textContent = "conectado";
    $("#conn-dot").classList.add("on");
    devi.classList.remove("offline");
  };
  es.onerror = () => {
    $("#conn").textContent = "Devi Hub desconectado, reconectando…";
    $("#conn-dot").classList.remove("on");
    devi.classList.add("offline");
  };
  es.addEventListener("card", (ev) => {
    const card = JSON.parse(ev.data);
    const key = `${card.type}:${card.request.id}`;
    const isNew = !cards.has(key);
    cards.set(key, card);
    if (isNew) {
      poke();
      const r = card.request;
      if (card.type === "request") notify(`Devi · ${nameOf(r.from)} te pide algo`, r.message);
      if (card.type === "response") notify(`Devi · Respuesta de ${nameOf(r.to)}`, `${OUTCOME[r.outcome]?.[0] ?? ""} ${r.outcomeText ?? ""}`.trim());
      if (card.type === "timeout") notify(`Devi · Sin respuesta de ${nameOf(r.to)}`, r.message);
    }
    if ([...cards.keys()][0] === key) mode = null;
    render();
  });
  es.addEventListener("resolved", (ev) => {
    const { type, id } = JSON.parse(ev.data);
    const key = `${type}:${id}`;
    if ([...cards.keys()][0] === key) mode = null;
    cards.delete(key);
    render();
  });
}

async function main() {
  team = await api("/api/team").catch(() => []);
  if (!user || !team.some((m) => m.id === user)) {
    const tpl = $("#who-tpl").content.cloneNode(true);
    tpl.querySelector(".who-list").append(...team.map((m) =>
      h("a", { href: `/?user=${m.id}` }, h("strong", {}, m.name), h("div", { class: "muted" }, m.role))));
    $("#current").append(tpl);
    $("#conn").textContent = "elige quién eres";
    return;
  }
  document.title = `Devi · ${nameOf(user)}`;
  $("#hello").textContent = `Hola, ${nameOf(user)}`;
  setupNotifButton();
  render();
  connect();
}

main();
