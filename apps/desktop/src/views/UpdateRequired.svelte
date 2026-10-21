<script lang="ts">
  // 426: la versión de esta app no es compatible con el servidor.
  import Devi from "../components/Devi.svelte";
  import { errorMessage } from "../lib/api";
  import { findUpdate, installAndRestart } from "../lib/updater";

  type Props = { minVersion: string };
  let { minVersion }: Props = $props();

  let status = $state<"idle" | "checking" | "none" | "installing">("idle");
  let pct = $state(0);
  let error = $state<string | null>(null);

  async function update() {
    status = "checking";
    error = null;
    const u = await findUpdate();
    if (!u) {
      status = "none";
      return;
    }
    status = "installing";
    try {
      await installAndRestart(u, (p) => (pct = p));
    } catch (e) {
      error = errorMessage(e);
      status = "idle";
    }
  }
</script>

<div class="screen">
  <Devi offline size={72} />
  <h1>Actualiza Devi</h1>
  <p class="muted">Esta versión no es compatible con el servidor del equipo{minVersion ? ` (mínima: ${minVersion})` : ""}.</p>
  <div class="actions center">
    <button class="primary" disabled={status === "checking" || status === "installing"} onclick={update}>
      {status === "installing" ? `Descargando… ${pct}%` : status === "checking" ? "Buscando…" : "Buscar actualización"}
    </button>
  </div>
  {#if status === "none"}
    <p class="muted small">
      No hay ninguna versión nueva publicada. Descarga la última desde la página de Releases del proyecto o pide al admin
      que actualice.
    </p>
  {/if}
  {#if error}<div class="error">{error}</div>{/if}
</div>
