<script lang="ts">
  import type { Update } from "@tauri-apps/plugin-updater";
  import { onMount } from "svelte";
  import { errorMessage } from "../lib/api";
  import { useApp } from "../lib/context";
  import { findUpdate, installAndRestart, watchUpdates } from "../lib/updater";

  const app = useApp();

  let update = $state.raw<Update | null>(null);
  let pct = $state<number | null>(null);
  let error = $state<string | null>(null);

  onMount(() => {
    if (import.meta.env.DEV) return; // en `tauri dev` no hay versiones publicadas que comparar
    return watchUpdates({
      find: findUpdate,
      onFound: (u) => {
        update = u;
        app.announceUpdate(u.version);
      },
    });
  });

  async function install() {
    if (!update) return;
    pct = 0;
    try {
      await installAndRestart(update, (p) => (pct = p));
    } catch (e) {
      error = errorMessage(e);
      pct = null;
    }
  }
</script>

{#if update}
  <div class="banner">
    <span>Devi {update.version} está disponible.</span>
    <button class="ghost" disabled={pct !== null} onclick={install}>
      {pct === null ? "Actualizar y reiniciar" : `Descargando… ${pct}%`}
    </button>
  </div>
  {#if error}<div class="error">{error}</div>{/if}
{/if}
