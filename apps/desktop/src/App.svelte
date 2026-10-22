<script lang="ts">
  // Un solo bundle para las tres ventanas (principal, mascota y avisos): la etiqueta de la ventana
  // decide qué se pinta.
  import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
  import { MASCOT_LABEL, markMascotDocument } from "./lib/mascot";
  import { POPOVER_LABEL, markPopoverDocument } from "./lib/popover";
  import MascotWindow from "./views/MascotWindow.svelte";
  import PopoverWindow from "./views/popover/PopoverWindow.svelte";
  import Shell from "./views/Shell.svelte";

  const label = getCurrentWebviewWindow().label;
  // Antes de montar nada: la mascota y el panel de avisos no llevan el fondo de la app.
  if (label === MASCOT_LABEL) markMascotDocument(document);
  if (label === POPOVER_LABEL) markPopoverDocument(document);
</script>

{#if label === MASCOT_LABEL}
  <MascotWindow />
{:else if label === POPOVER_LABEL}
  <PopoverWindow />
{:else}
  <Shell />
{/if}
