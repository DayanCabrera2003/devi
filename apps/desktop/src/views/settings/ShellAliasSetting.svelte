<script lang="ts">
  // Función `claude` en los perfiles de shell (`devi shell-alias`): escribir `claude` equivale a `devi claude`.
  import { onMount } from "svelte";
  import { errorMessage } from "../../lib/api";
  import { useApp } from "../../lib/context";
  import { deviFailure, lastJsonLine } from "../../lib/format";

  type AliasStatus = { installed: boolean; files: { path: string; installed: boolean }[] };

  const app = useApp();
  let status = $state<AliasStatus | null>(null);
  let busy = $state(false);
  let error = $state<string | null>(null);

  async function refresh() {
    const out = await app.native.runDevi(["shell-alias", "status", "--json"]);
    const s = lastJsonLine<AliasStatus>(out.stdout);
    if (out.code !== 0 || !s) throw new Error(deviFailure(out, "No se pudo leer el estado de la función claude"));
    status = s;
  }

  onMount(() => {
    refresh().catch((e) => (error = errorMessage(e)));
  });

  // Como los demás interruptores: si falla, se muestra el error y la casilla vuelve al estado real.
  async function change(box: HTMLInputElement) {
    const on = box.checked;
    busy = true;
    error = null;
    try {
      const out = await app.native.runDevi(["shell-alias", on ? "install" : "remove"]);
      if (out.code !== 0) throw new Error(deviFailure(out, on ? "No se pudo instalar" : "No se pudo quitar"));
    } catch (e) {
      error = errorMessage(e);
    }
    try {
      await refresh();
    } catch (e) {
      error ??= errorMessage(e);
    }
    box.checked = error ? (status?.installed ?? !on) : (status?.installed ?? on);
    busy = false;
  }
</script>

<section class="group-box">
  <h2 class="group-title">Terminal</h2>
  <div class="inset">
    <div class="cell">
      <label class="check">
        <input class="switch" type="checkbox" checked={status?.installed ?? false} disabled={busy} onchange={(e) => change(e.currentTarget)} />
        <span>Usar Devi automáticamente al escribir <span class="mono">claude</span> en la terminal</span>
      </label>
    </div>
    {#if status?.installed}
      <div class="cell stack">
        <ul class="saved mono small" style="margin: 0">
          {#each status.files.filter((f) => f.installed) as f (f.path)}<li>{f.path}</li>{/each}
        </ul>
      </div>
    {/if}
  </div>
  <p class="group-foot">
    Se aplica a las terminales nuevas. Para el <span class="mono">claude</span> original: <span class="mono">command claude</span>
    (o <span class="mono">claude.exe</span> en PowerShell).
  </p>
  {#if error}<div class="error">{error}</div>{/if}
</section>
