<script lang="ts">
  // Ventana principal: crea DeviApp, la conecta con Tauri (eventos del tray, mascota, archivos
  // arrastrados) y pinta ShellView.
  import { listen } from "@tauri-apps/api/event";
  import { onMount } from "svelte";
  import { createApp } from "../lib/boot";
  import { provideApp } from "../lib/context";
  import { MASCOT_READY } from "../lib/mascot";
  import ShellView from "./ShellView.svelte";

  const app = createApp();
  provideApp(app);

  onMount(() => {
    const offs = [
      listen<boolean>("devi://paused", (e) => app.setPaused(e.payload)),
      listen<string>("devi://navigate", (e) => {
        if (e.payload === "ajustes") app.goto("ajustes");
      }),
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
