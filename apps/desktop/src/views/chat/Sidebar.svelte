<script lang="ts">
  // Lista de conversaciones: Devi arriba, búsqueda (Ctrl/Cmd+K), Todo / Te esperan y una fila por compañero.
  import Avatar from "../../components/Avatar.svelte";
  import Devi from "../../components/Devi.svelte";
  import Icon from "../../components/Icon.svelte";
  import { useApp } from "../../lib/context";
  import { listTime } from "../../lib/format";
  import { native } from "../../lib/native";
  import { type ConversationRow, buildRows, filterRows } from "../../lib/stores/conversations.svelte";
  import type { Card } from "../../lib/stores/inbox.svelte";
  import { AGENT_THREAD, cardPeer } from "../../lib/thread-items";
  import UpdateBanner from "../UpdateBanner.svelte";

  const app = useApp();
  let search: HTMLInputElement;

  const rows = $derived(buildRows(app.convos.items, app.team.team.members, app.team.myId, app.waiting));
  const agentWaiting = $derived(app.waiting[AGENT_THREAD] ?? 0);
  const totalWaiting = $derived(rows.reduce((n, r) => n + r.waiting, 0) + agentWaiting);
  const shown = $derived(filterRows(rows, app.convos.filter, app.convos.query));
  const hello = $derived(app.team.me ? `Hola, ${app.team.me.member.name}` : "Devi");
  const status = $derived(
    !app.conn.online
      ? app.conn.label
      : totalWaiting === 0
        ? "Todo tranquilo"
        : totalWaiting === 1
          ? "1 cosa te espera"
          : `${totalWaiting} cosas te esperan`,
  );

  // Última tarjeta abierta de cada persona: da vista previa y hora si el servidor aún no las da.
  const lastCard = $derived.by(() => {
    const out: Record<string, Card> = {};
    for (const c of app.inbox.cards) {
      const peer = cardPeer(c, (id) => app.lookupRequest(id));
      if (peer) out[peer] = c;
    }
    return out;
  });

  function preview(r: ConversationRow): { text: string; at: number | null } {
    if (r.lastPreview !== null) return { text: r.lastFromMe ? `Tú: ${r.lastPreview}` : r.lastPreview, at: r.lastAt };
    const c = lastCard[r.memberId];
    if (!c) return { text: r.connected ? "En línea" : "Sin mensajes todavía", at: null };
    if (c.kind === "draft") return { text: `Tu agente: ${c.draft.message}`, at: c.draft.createdAt };
    const fromMe = c.request.fromMemberId === app.team.myId;
    return { text: fromMe ? `Tú: ${c.request.message}` : c.request.message, at: c.request.sentAt };
  }

  const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);

  function onKey(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      if (app.view !== "bandeja") app.goto("bandeja");
      search?.focus();
      search?.select();
    }
  }

  function open(id: string) {
    void app.openConversation(id);
  }
</script>

<svelte:window onkeydown={onKey} />

<aside class="sidebar" aria-label="Conversaciones">
  <div class="side-top">
    <div class="toolbar">
      <span class="conn" title={app.conn.label}><span class="dot" class:on={app.conn.online}></span><span>{app.conn.label}</span></span>
      <span class="spacer"></span>
      <button class="icon" class:active={app.view === "ajustes"} aria-label="Ajustes" title="Ajustes" onclick={() => app.goto(app.view === "ajustes" ? "bandeja" : "ajustes")}>
        <Icon name="gear" />
      </button>
      {#if app.team.isAdmin}
        <button class="icon" class:active={app.view === "admin"} aria-label="Admin" title="Admin" onclick={() => app.goto(app.view === "admin" ? "bandeja" : "admin")}>
          <Icon name="people" />{#if app.auditAlerts.length > 0}<span class="tab-count" aria-label="{app.auditAlerts.length} alertas nuevas">{app.auditAlerts.length}</span>{/if}
        </button>
      {/if}
      <!-- Sin icono de bandeja (GNOME sin AppIndicator) esta es la única forma de cerrar Devi. -->
      <button class="icon" aria-label="Salir de Devi" title="Cierra Devi y su servidor" onclick={() => void native.quitApp()}>
        <Icon name="power" />
      </button>
    </div>

    <div class="me-card">
      <div class="me-devi"><Devi size={60} offline={!app.conn.online} looking={totalWaiting > 0} pokeKey={app.pokeKey} /></div>
      <div class="me-text">
        <div class="me-name">{hello}</div>
        <div class="me-status" class:waiting={app.conn.online && totalWaiting > 0}>{status}</div>
      </div>
    </div>

    <label class="search glass flat">
      <Icon name="search" />
      <input bind:this={search} type="search" placeholder="Buscar" aria-label="Buscar compañeros" bind:value={app.convos.query} />
      <kbd>{isMac ? "⌘K" : "Ctrl K"}</kbd>
    </label>

    <div class="segmented" role="group" aria-label="Filtro">
      <button class:active={app.convos.filter === "all"} aria-pressed={app.convos.filter === "all"} onclick={() => (app.convos.filter = "all")}>Todo</button>
      <button class:active={app.convos.filter === "waiting"} aria-pressed={app.convos.filter === "waiting"} onclick={() => (app.convos.filter = "waiting")}>
        Te esperan <span class="n">· {totalWaiting}</span>
      </button>
    </div>
  </div>

  <div class="side-banners">
    <UpdateBanner />
    {#if app.paused}
      <div class="banner">
        <span>Avisos en pausa.</span>
        <button class="ghost" onclick={() => app.togglePause(false).catch((e) => console.warn("[devi] reanudar", e))}>Reanudar</button>
      </div>
    {/if}
  </div>

  <ul class="convo-list">
    {#if agentWaiting > 0}
      <li>
        <button class="row" class:active={app.selected === AGENT_THREAD && app.view === "bandeja"} onclick={() => open(AGENT_THREAD)}>
          <span class="avatar agent" style:--size="40px" aria-hidden="true"><Devi size={26} /></span>
          <span class="row-main">
            <span class="row-top"><span class="row-name">Tu agente</span></span>
            <span class="row-bottom">
              <span class="row-preview">Borradores por autorizar</span>
              <span class="wait-count" aria-label="{agentWaiting} por autorizar">{agentWaiting}</span>
            </span>
          </span>
        </button>
      </li>
    {/if}
    {#each shown as r (r.memberId)}
      {@const p = preview(r)}
      <li>
        <button
          class="row"
          class:active={app.selected === r.memberId && app.view === "bandeja"}
          aria-current={app.selected === r.memberId ? "true" : undefined}
          onclick={() => open(r.memberId)}
        >
          <Avatar name={r.name} online={r.connected} />
          <span class="row-main">
            <span class="row-top">
              <span class="row-name">{r.name}</span>
              <span class="row-time">{listTime(p.at, app.clock.now)}</span>
            </span>
            <span class="row-bottom">
              <span class="row-preview">{p.text}</span>
              {#if r.waiting > 1}
                <span class="wait-count" aria-label="{r.waiting} te esperan">{r.waiting}</span>
              {:else if r.waiting === 1}
                <span class="wait-dot" aria-label="te espera"></span>
              {/if}
            </span>
          </span>
        </button>
      </li>
    {:else}
      <li class="list-empty">
        {#if app.convos.query.trim()}
          Nadie coincide con «{app.convos.query.trim()}».
        {:else if app.convos.filter === "waiting"}
          Nada te espera. Cuando un compañero te pida algo, aparecerá aquí.
        {:else}
          Aún no hay nadie más en el equipo. Invita a alguien desde Admin.
        {/if}
      </li>
    {/each}
  </ul>
</aside>
