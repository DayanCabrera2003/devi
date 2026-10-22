<script lang="ts">
  // Ventana `avisos`: su propia DeviApp, conectada mientras se usa. Al perder el foco Rust la oculta;
  // si sigue oculta IDLE_DISCONNECT_MS se suelta la conexión y al volver a enfocarla se reconecta
  // (el servidor reenvía lo pendiente). Lo que se haga aquí llega a la ventana principal por el SSE.
  import { emitTo, listen } from "@tauri-apps/api/event";
  import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
  import { onMount } from "svelte";
  import { createPopoverApp } from "../../lib/boot";
  import { provideApp } from "../../lib/context";
  import { native } from "../../lib/native";
  import { IDLE_DISCONNECT_MS, NAVIGATE_EVENT, OPEN_CONVERSATION_EVENT, PAUSED_EVENT, type PopoverHost } from "../../lib/popover";
  import { followStoredTheme } from "../../lib/theme";
  import PopoverView from "./PopoverView.svelte";

  const app = createPopoverApp();
  provideApp(app);
  const win = getCurrentWebviewWindow();

  const host: PopoverHost = {
    openMain: (memberId) => {
      if (memberId) void emitTo("main", OPEN_CONVERSATION_EVENT, memberId).catch(() => {});
      void native.showMainWindow();
      void win.hide();
    },
    openSettings: () => {
      void emitTo("main", NAVIGATE_EVENT, "ajustes").catch(() => {});
      void native.showMainWindow();
      void win.hide();
    },
    close: () => void win.hide(),
  };

  let live = false;
  let idle: ReturnType<typeof setTimeout> | null = null;

  async function wake() {
    if (idle) clearTimeout(idle);
    idle = null;
    native.trayStatus().then((s) => app.setPaused(s.paused), () => {});
    if (live) return;
    live = true;
    try {
      app.config = await native.readConfig();
    } catch (e) {
      console.error("[devi] no se pudo leer config.json", e);
    }
    app.phase = "app";
    await app.connect();
  }

  function sleepSoon() {
    if (idle) clearTimeout(idle);
    idle = setTimeout(() => {
      idle = null;
      live = false;
      app.disconnect();
    }, IDLE_DISCONNECT_MS);
  }

  onMount(() => {
    const stopTheme = followStoredTheme();
    const stopClock = app.clock.start();
    const offs = [
      listen<boolean>(PAUSED_EVENT, (e) => app.setPaused(e.payload)),
      win.onFocusChanged(({ payload: focused }) => (focused ? void wake() : sleepSoon())),
    ];
    void wake();
    return () => {
      if (idle) clearTimeout(idle);
      stopTheme();
      stopClock();
      app.disconnect();
      for (const off of offs) void off.then((f) => f());
    };
  });
</script>

<PopoverView {host} />
