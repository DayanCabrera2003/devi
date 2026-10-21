<script lang="ts">
  import type { Card } from "../lib/stores/inbox.svelte";
  import DraftCard from "./DraftCard.svelte";
  import RequestCard from "./RequestCard.svelte";
  import ResponseCard from "./ResponseCard.svelte";
  import TimeoutCard from "./TimeoutCard.svelte";

  type Props = { card: Card };
  let { card }: Props = $props();
</script>

{#if card.kind === "draft"}
  <DraftCard draft={card.draft} />
{:else if card.kind === "request"}
  <RequestCard request={card.request} />
{:else if card.kind === "response"}
  <ResponseCard request={card.request} />
{:else}
  <TimeoutCard request={card.request} />
{/if}
