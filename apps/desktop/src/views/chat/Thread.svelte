<script lang="ts">
  // Conversación con una persona: cabecera de cristal, burbujas y barra de escritura flotante.
  import { tick } from "svelte";
  import Avatar from "../../components/Avatar.svelte";
  import Devi from "../../components/Devi.svelte";
  import Icon from "../../components/Icon.svelte";
  import DraftCard from "../../cards/DraftCard.svelte";
  import HistoryItem from "../../cards/HistoryItem.svelte";
  import RequestCard from "../../cards/RequestCard.svelte";
  import ResponseCard from "../../cards/ResponseCard.svelte";
  import TimeoutCard from "../../cards/TimeoutCard.svelte";
  import { useApp } from "../../lib/context";
  import { AGENT_THREAD, buildThreadItems } from "../../lib/thread-items";
  import Composer from "./Composer.svelte";

  type Props = { memberId: string };
  let { memberId }: Props = $props();
  const app = useApp();

  const agent = $derived(memberId === AGENT_THREAD);
  const member = $derived(app.team.team.members.find((m) => m.id === memberId));
  const name = $derived(agent ? "Tu agente" : (member?.name ?? memberId));
  const role = $derived(member?.roleIds.map((id) => app.team.role(id)?.name).find(Boolean));
  const online = $derived(!!member?.connected && !member?.disabled);

  // Cuántas sesiones tiene abiertas (si el servidor lo deja ver; si no, solo "en línea").
  let sessions = $state<number | null>(null);
  $effect(() => {
    const id = memberId;
    sessions = null;
    if (agent || !online) return;
    app
      .call((a) => a.memberSessions(id))
      .then((list) => {
        if (id === memberId) sessions = list.length;
      })
      .catch(() => {});
  });

  const sub = $derived.by(() => {
    if (agent) return "Borradores que esperan tu autorización";
    const parts = [role, online ? (sessions ? `en línea · ${sessions} ${sessions === 1 ? "sesión" : "sesiones"}` : "en línea") : "desconectado"];
    return parts.filter(Boolean).join(" · ");
  });

  const items = $derived(
    buildThreadItems({
      memberId,
      requests: agent ? [] : app.thread.requests,
      cards: app.inbox.cards,
      lookup: (id) => app.lookupRequest(id),
      now: app.clock.now,
    }),
  );

  // Al abrir y cuando llega algo nuevo (si ya se estaba abajo), se baja hasta el final.
  let scroller: HTMLDivElement;
  // La barra de escritura flota encima: el hilo deja debajo tanto espacio como ella ocupe.
  let composerHeight = $state(64);
  let stick = true;
  let lastCount = 0;
  $effect(() => {
    const n = items.length;
    if (n === lastCount) return;
    const first = lastCount === 0;
    lastCount = n;
    if (!first && !stick) return;
    void tick().then(() => scroller?.scrollTo({ top: scroller.scrollHeight }));
  });

  function onScroll() {
    if (!scroller) return;
    stick = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
  }

  function back() {
    app.closeConversation();
  }
</script>

<section class="thread" aria-label="Conversación con {name}">
  <header class="thread-head glass">
    <button class="icon back" aria-label="Volver a la lista" onclick={back}><Icon name="back" /></button>
    {#if agent}
      <span class="avatar agent" style:--size="34px" aria-hidden="true"><Devi size={22} /></span>
    {:else}
      <Avatar {name} size={34} {online} />
    {/if}
    <div class="who">
      <div class="who-name">{name}</div>
      <div class="who-sub">{sub}</div>
    </div>
  </header>

  <div
    class="thread-scroll"
    class:no-composer={agent}
    style:padding-bottom={agent ? undefined : `${composerHeight + 28}px`}
    bind:this={scroller}
    onscroll={onScroll}
  >
    <div class="thread-items">
      {#if app.thread.nextBefore !== undefined && !agent}
        <button class="ghost older" disabled={app.thread.loadingMore} onclick={() => app.loadOlder()}>
          {app.thread.loadingMore ? "Cargando…" : "Ver mensajes anteriores"}
        </button>
      {/if}
      {#each items as it (it.key)}
        {#if it.kind === "day"}
          <div class="day">{it.label}</div>
        {:else if it.kind === "draft"}
          <DraftCard draft={it.draft} />
        {:else if it.card?.kind === "request"}
          <RequestCard request={it.request} />
        {:else if it.card?.kind === "response"}
          <ResponseCard request={it.request} />
        {:else if it.card?.kind === "timeout"}
          <TimeoutCard request={it.request} />
        {:else}
          <HistoryItem request={it.request} />
        {/if}
      {:else}
        {#if app.thread.loading}
          <div class="thread-empty">Cargando la conversación…</div>
        {:else if agent}
          <div class="thread-empty">Tu agente no tiene nada pendiente.</div>
        {:else}
          <div class="thread-empty">
            Aún no habéis hablado. Escribe a {name} abajo o pídeselo a tu agente desde Claude Code.
          </div>
        {/if}
      {/each}
      {#if app.thread.error}<div class="error" style="align-self: center">{app.thread.error}</div>{/if}
    </div>
  </div>

  {#if !agent}
    <div class="composer-slot" bind:clientHeight={composerHeight}><Composer {name} /></div>
  {/if}
</section>
