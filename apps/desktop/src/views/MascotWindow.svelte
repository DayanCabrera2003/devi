<script lang="ts">
  // Burbuja opcional siempre encima (Ajustes → Mostrar a Devi flotando), sin fondo de ventana:
  // conectado / reconectando (gris) / pendientes. Se arrastra por el fondo; el botón abre la principal.
  import { emitTo, listen } from "@tauri-apps/api/event";
  import { onMount } from "svelte";
  import Devi from "../components/Devi.svelte";
  import { MASCOT_EVENT, MASCOT_READY, markMascotDocument, type MascotState } from "../lib/mascot";
  import { native } from "../lib/native";
  import { followStoredTheme } from "../lib/theme";

  type Props = { initial?: MascotState };
  let { initial }: Props = $props();
  // svelte-ignore state_referenced_locally
  let s = $state<MascotState>(initial ?? { online: false, pending: 0, label: "conectando…", pokeKey: 0, mood: "offline" });

  onMount(() => {
    markMascotDocument(document);
    const stopTheme = followStoredTheme();
    const off = listen<MascotState>(MASCOT_EVENT, (e) => (s = e.payload));
    void emitTo("main", MASCOT_READY).catch(() => {});
    return () => {
      stopTheme();
      void off.then((f) => f());
    };
  });

  const text = $derived(
    !s.online ? "reconectando…" : s.pending > 0 ? `${s.pending} pendiente${s.pending === 1 ? "" : "s"}` : "todo tranquilo",
  );
</script>

<div class="mascot" data-tauri-drag-region>
  <div class="mascot-disc glass" data-tauri-drag-region>
    <div class="mascot-devi" data-tauri-drag-region>
      <Devi size={64} offline={!s.online} mood={s.mood} pokeKey={s.pokeKey} />
    </div>
    {#if s.online && s.pending > 0}<span class="mascot-badge" aria-hidden="true">{s.pending}</span>{/if}
    <button class="mascot-pill" class:offline={!s.online} title={s.label} onclick={() => native.showMainWindow()}>
      {text}
    </button>
  </div>
</div>
