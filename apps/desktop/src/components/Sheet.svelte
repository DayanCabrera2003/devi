<script lang="ts">
  // Hoja de cristal sobre la ventana (en pantallas pequeñas sale desde abajo). Escape o el fondo la cierran.
  // inline: dentro del contenido, sin fondo modal (el panel de avisos es demasiado pequeño para hojas).
  import type { Snippet } from "svelte";
  import { onMount } from "svelte";
  import Icon from "./Icon.svelte";

  type Props = { title: string; onClose: () => void; wide?: boolean; inline?: boolean; children: Snippet };
  let { title, onClose, wide = false, inline = false, children }: Props = $props();
  let box = $state<HTMLDivElement>();

  onMount(() => {
    const prev = document.activeElement as HTMLElement | null;
    box?.focus();
    return () => prev?.focus?.();
  });

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
    }
  }
</script>

{#snippet head()}
  <div class="sheet-head">
    <h2>{title}</h2>
    <button class="icon round" aria-label="Cerrar" onclick={onClose}><Icon name="close" /></button>
  </div>
{/snippet}

{#if inline}
  <!-- Escape vuelve atrás sin cerrar el panel que lo contiene. -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div class="sheet inline" role="group" aria-label={title} tabindex="-1" bind:this={box} onkeydown={onKey}>
    {@render head()}
    {@render children()}
  </div>
{:else}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="scrim" onclick={(e) => e.target === e.currentTarget && onClose()} onkeydown={onKey}>
    <div class="sheet glass" class:wide role="dialog" aria-modal="true" aria-label={title} tabindex="-1" bind:this={box}>
      {@render head()}
      {@render children()}
    </div>
  </div>
{/if}
