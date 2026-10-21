<script lang="ts">
  // Ventana pequeña siempre encima: conectado / reconectando (gris) / pendientes.
  // Funciona sin tray (GNOME sin extensión). Se arrastra por el fondo; el botón abre la principal.
  import { emitTo, listen } from "@tauri-apps/api/event";
  import { onMount } from "svelte";
  import Devi from "../components/Devi.svelte";
  import { MASCOT_EVENT, MASCOT_READY, type MascotState } from "../lib/mascot";
  import { native } from "../lib/native";

  let s = $state<MascotState>({ online: false, pending: 0, label: "conectando…", pokeKey: 0 });

  onMount(() => {
    document.body.classList.add("mascota");
    const off = listen<MascotState>(MASCOT_EVENT, (e) => (s = e.payload));
    void emitTo("main", MASCOT_READY);
    return () => void off.then((f) => f());
  });

  const text = $derived(
    !s.online ? "reconectando…" : s.pending > 0 ? `${s.pending} pendiente${s.pending === 1 ? "" : "s"}` : "todo tranquilo",
  );
</script>

<div class="mascot" data-tauri-drag-region>
  <div class="mascot-devi" data-tauri-drag-region>
    <Devi size={72} offline={!s.online} looking={s.pending > 0} pokeKey={s.pokeKey} />
  </div>
  <button class="mascot-pill" class:offline={!s.online} title={s.label} onclick={() => native.showMainWindow()}>
    {text}
  </button>
</div>
