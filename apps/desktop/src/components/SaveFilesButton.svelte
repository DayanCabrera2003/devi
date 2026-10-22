<script lang="ts">
  // Copia los archivos a <carpeta de recibidos>/<request_id>/ (o .../respuesta/) para usarlos uno mismo.
  // Es la misma carpeta que usa el MCP, que reutiliza los que ya existan.
  import { errorMessage } from "../lib/api";

  type Props = { save: () => Promise<string[]> };
  let { save }: Props = $props();

  let busy = $state(false);
  let paths = $state<string[] | null>(null);
  let error = $state<string | null>(null);

  async function run() {
    busy = true;
    error = null;
    try {
      paths = await save();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      busy = false;
    }
  }
</script>

<div class="command">
  <button class="ghost small" disabled={busy} onclick={run}>{busy ? "Guardando…" : "Guardar archivos en mi carpeta"}</button>
  {#if paths}
    <ul class="saved">
      {#each paths as p (p)}<li class="mono small">{p}</li>{/each}
    </ul>
  {/if}
  {#if error}<div class="error">{error}</div>{/if}
</div>
