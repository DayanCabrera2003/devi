<script lang="ts">
  // Ventana principal: crea DeviApp, la conecta con Tauri (eventos del tray y del panel de avisos, mascota, archivos
  // arrastrados) y pinta ShellView.
  import { listen } from "@tauri-apps/api/event";
  import { onMount, untrack } from "svelte";
  import { createApp } from "../lib/boot";
  import { provideApp } from "../lib/context";
  import { MASCOT_READY } from "../lib/mascot";
  import { NAVIGATE_EVENT, OPEN_CONVERSATION_EVENT, PAUSED_EVENT } from "../lib/popover";
  import ShellView from "./ShellView.svelte";

  const app = createApp();
  provideApp(app);

  // El humor también cambia con el tiempo (se duerme, se le pasa la alegría): la mascota flotante lo sigue.
  $effect(() => {
    void app.mood;
    untrack(() => app.publishMascot());
  });

  onMount(() => {
    const offs = [
      listen<boolean>(PAUSED_EVENT, (e) => app.setPaused(e.payload)),
      listen<string>(NAVIGATE_EVENT, (e) => {
        if (e.payload === "ajustes") app.goto("ajustes");
      }),
      // Desde el panel de avisos: "Abrir Devi" tras pulsar una tarjeta.
      listen<string>(OPEN_CONVERSATION_EVENT, (e) => void app.openConversation(e.payload)),
      listen(MASCOT_READY, () => app.publishMascot()),
    ];
    const stopDrops = app.listenForDrops();
    const stopClock = app.clock.start();
    void app.boot();
    return () => {
      stopClock();
      stopDrops();
      app.disconnect();
      for (const off of offs) void off.then((f) => f());
    };
  });
</script>

<ShellView />
