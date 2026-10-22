<script lang="ts">
  // Un solo bundle para las dos ventanas: la etiqueta de la ventana decide qué se pinta.
  import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
  import { MASCOT_LABEL, markMascotDocument } from "./lib/mascot";
  import MascotWindow from "./views/MascotWindow.svelte";
  import Shell from "./views/Shell.svelte";

  const label = getCurrentWebviewWindow().label;
  // Antes de montar nada: la mascota no lleva el fondo de la app.
  if (label === MASCOT_LABEL) markMascotDocument(document);
</script>

{#if label === MASCOT_LABEL}
  <MascotWindow />
{:else}
  <Shell />
{/if}
