<script lang="ts">
  // Tarjeta compacta del panel de avisos: de quién es (pulsar la elige para "Abrir Devi") y la
  // misma tarjeta que en la conversación, con sus acciones, avisos de seguridad y formularios en línea.
  import Avatar from "../../components/Avatar.svelte";
  import DraftCard from "../../cards/DraftCard.svelte";
  import RequestCard from "../../cards/RequestCard.svelte";
  import ResponseCard from "../../cards/ResponseCard.svelte";
  import TimeoutCard from "../../cards/TimeoutCard.svelte";
  import { useApp } from "../../lib/context";
  import { cardHeading } from "../../lib/popover";
  import type { Card } from "../../lib/stores/inbox.svelte";
  import { AGENT_THREAD } from "../../lib/thread-items";

  type Props = { card: Card; selected: boolean; onSelect: (memberId: string) => void };
  let { card, selected, onSelect }: Props = $props();
  const app = useApp();

  const heading = $derived(cardHeading(card, (id) => app.team.nameOf(id), (id) => app.lookupRequest(id)));
  const avatarName = $derived(heading.memberId === AGENT_THREAD ? "Tu agente" : app.team.nameOf(heading.memberId));
</script>

<article class="pop-card" class:selected>
  <button class="pop-card-head" aria-pressed={selected} onclick={() => onSelect(heading.memberId)}>
    <Avatar name={avatarName} size={22} />
    <span class="pop-card-title">{heading.title}</span>
  </button>
  <div class="pop-card-body">
    {#if card.kind === "request"}
      <RequestCard request={card.request} compact />
    {:else if card.kind === "response"}
      <ResponseCard request={card.request} compact />
    {:else if card.kind === "timeout"}
      <TimeoutCard request={card.request} />
    {:else}
      <DraftCard draft={card.draft} />
    {/if}
  </div>
</article>
