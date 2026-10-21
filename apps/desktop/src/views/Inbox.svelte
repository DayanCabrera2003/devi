<script lang="ts">
  // Bandeja: la primera tarjeta en grande y el resto en una cola compacta, como en el proof of concept.
  import CardView from "../cards/CardView.svelte";
  import { useApp } from "../lib/context";
  import type { Card } from "../lib/stores/inbox.svelte";

  const app = useApp();
  const first = $derived(app.inbox.cards[0]);
  const rest = $derived(app.inbox.cards.slice(1));

  function label(c: Card): string {
    switch (c.kind) {
      case "draft":
        return "Borrador por autorizar";
      case "request":
        return `Solicitud · ${app.team.nameOf(c.request.fromMemberId)}`;
      case "response":
        return `Respuesta · ${app.team.nameOf(c.request.toMemberId)}`;
      case "timeout":
        return `Sin respuesta · ${app.team.nameOf(c.request.toMemberId)}`;
    }
  }
</script>

{#if !first}
  <div class="empty">Todo tranquilo. Te aviso cuando alguien te necesite.</div>
{:else}
  {#key first.key}
    <CardView card={first} />
  {/key}
  {#if rest.length > 0}
    <section class="queue">
      {#each rest as c (c.key)}
        <div class="card">{label(c)}</div>
      {/each}
    </section>
  {/if}
{/if}
