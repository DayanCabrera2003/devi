<script lang="ts">
  // Hoja de cristal sobre la ventana (en pantallas pequeñas sale desde abajo). Escape o el fondo la cierran.
  import type { Snippet } from "svelte";
  import { onMount } from "svelte";
  import Icon from "./Icon.svelte";

  type Props = { title: string; onClose: () => void; wide?: boolean; children: Snippet };
  let { title, onClose, wide = false, children }: Props = $props();
  let box: HTMLDivElement;

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

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="scrim" onclick={(e) => e.target === e.currentTarget && onClose()} onkeydown={onKey}>
  <div class="sheet glass" class:wide role="dialog" aria-modal="true" aria-label={title} tabindex="-1" bind:this={box}>
    <div class="sheet-head">
      <h2>{title}</h2>
      <button class="icon round" aria-label="Cerrar" onclick={onClose}><Icon name="close" /></button>
    </div>
    {@render children()}
  </div>
</div>
