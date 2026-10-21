<script lang="ts">
  // Un solo bundle para las dos ventanas: la etiqueta de la ventana decide qué se pinta.
  import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
  import MascotWindow from "./views/MascotWindow.svelte";
  import Shell from "./views/Shell.svelte";

  const label = getCurrentWebviewWindow().label;
</script>

{#if label === "mascota"}
  <MascotWindow />
{:else}
  <Shell />
{/if}
