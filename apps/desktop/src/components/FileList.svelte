<script lang="ts">
  // Archivos de una tarjeta con vista previa de texto (se lee del servidor; no se escribe a disco).
  // Al previsualizar un archivo se analiza por si trae prompt injection; onScan avisa a la tarjeta.
  import { type FileMeta, type InjectionScan, scanForInjection } from "@devi/protocol";
  import { errorMessage } from "../lib/api";
  import { formatBytes } from "../lib/format";
  import InjectionWarning from "./InjectionWarning.svelte";

  type Props = { files: FileMeta[]; load: (id: string) => Promise<string>; onScan?: (id: string, scan: InjectionScan) => void };
  let { files, load, onScan }: Props = $props();

  let open = $state<string | null>(null);
  let contents = $state<Record<string, string>>({});
  let errors = $state<Record<string, string>>({});
  let scans = $state<Record<string, InjectionScan>>({});

  async function toggle(f: FileMeta) {
    if (open === f.id) {
      open = null;
      return;
    }
    open = f.id;
    if (contents[f.id] !== undefined) return;
    delete errors[f.id];
    try {
      const text = await load(f.id);
      contents[f.id] = text;
      const scan = scanForInjection(text);
      scans[f.id] = scan;
      onScan?.(f.id, scan);
    } catch (e) {
      errors[f.id] = errorMessage(e);
    }
  }
</script>

{#if files.length > 0}
  <ul class="files">
    {#each files as f (f.id)}
      <li>
        <button class="file" aria-expanded={open === f.id} onclick={() => toggle(f)}>
          <span class="mono">{f.name}</span>
          <span class="muted small">{formatBytes(f.size)}</span>
        </button>
        {#if open === f.id}
          {#if contents[f.id] !== undefined}
            {@const scan = scans[f.id]}
            {#if scan}<InjectionWarning {scan} where={f.name} />{/if}
            <pre class="preview">{contents[f.id]}</pre>
          {:else if errors[f.id]}
            <div class="error">{errors[f.id]}</div>
          {:else}
            <div class="muted small">Cargando…</div>
          {/if}
        {/if}
      </li>
    {/each}
  </ul>
{/if}
