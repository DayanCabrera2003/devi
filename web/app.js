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
  if (c.type === "request") return mode === "pick-session" ? renderPicker(c) : renderRequest(c);
  return h("div", { class: "card" }, kicker(c));
}

function renderRequest(c) {
  const r = c.request;
  return h("div", { class: "card" },
    h("div", { class: "card-kicker" }, "Solicitud"),
    h("div", { class: "card-title" }, `${nameOf(r.from)} te pide algo`),
    h("div", { class: "card-from" }, "desde la sesión ", h("span", { class: "mono" }, r.fromSessionName)),
    h("p", { class: "card-msg" }, r.message),
    h("div", { class: "actions" },
      h("button", { class: "primary", onclick: () => { mode = "pick-session"; render(); } }, "Enviar a sesión"),
    ),
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
    h("div", { class: "actions" }, h("button", { onclick: () => { mode = null; render(); } }, "Volver")),
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
      if (card.type === "response") notify(`Devi · Respuesta de ${nameOf(r.to)}`, r.outcomeText ?? "");
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
