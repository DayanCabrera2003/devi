<script lang="ts">
  // Ejecuta una invocación permitida del binario `devi` empaquetado y muestra su salida.
  import { errorMessage } from "../lib/api";
  import { type DeviOutput, native } from "../lib/native";

  type Props = { args: string[]; label: string; onDone?: (out: DeviOutput) => void };
  let { args, label, onDone }: Props = $props();

  let busy = $state(false);
  let out = $state<DeviOutput | null>(null);
  let error = $state<string | null>(null);

  async function run() {
    busy = true;
    error = null;
    out = null;
    try {
      out = await native.runDevi(args);
      onDone?.(out);
    } catch (e) {
      error = errorMessage(e);
    } finally {
      busy = false;
    }
  }
</script>

<div class="command">
  <button disabled={busy} onclick={run}>{busy ? "Ejecutando…" : label}</button>
  {#if out}
    <div class={out.code === 0 ? "ok-text" : "error"}>
      {out.code === 0 ? "Hecho." : `Terminó con código ${out.code ?? "desconocido"}.`}
    </div>
    {#if out.stdout || out.stderr}<pre class="preview">{out.stdout}{out.stderr}</pre>{/if}
  {/if}
  {#if error}<div class="error">{error}</div>{/if}
</div>
