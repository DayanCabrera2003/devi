<script lang="ts">
  // Adjuntos como tarjetas de documento; al pulsar uno se abre su vista previa en una hoja
  // (se lee del servidor; no se escribe a disco). Al previsualizar se analiza por si trae
  // prompt injection; onScan avisa a la tarjeta.
  import { type FileMeta, type InjectionScan, scanForInjection } from "@devi/protocol";
  import { errorMessage } from "../lib/api";
  import { formatBytes } from "../lib/format";
  import InjectionWarning from "./InjectionWarning.svelte";
  import Sheet from "./Sheet.svelte";

  type Props = { files: FileMeta[]; load: (id: string) => Promise<string>; onScan?: (id: string, scan: InjectionScan) => void };
  let { files, load, onScan }: Props = $props();

  let open = $state<string | null>(null);
  let contents = $state<Record<string, string>>({});
  let errors = $state<Record<string, string>>({});
  let scans = $state<Record<string, InjectionScan>>({});

  const ext = (name: string) => (name.includes(".") ? name.split(".").pop()!.slice(0, 4) : "txt");

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
          <span class="file-icon" aria-hidden="true">{ext(f.name)}</span>
          <span class="file-meta">
            <span class="file-name mono">{f.name}</span>
            <span class="file-size">{formatBytes(f.size)}</span>
          </span>
        </button>
        {#if open === f.id}
          <Sheet title={f.name} wide onClose={() => (open = null)}>
            {#if contents[f.id] !== undefined}
              {@const scan = scans[f.id]}
              {#if scan}<InjectionWarning {scan} where={f.name} />{/if}
              <pre class="preview">{contents[f.id]}</pre>
            {:else if errors[f.id]}
              <div class="error">{errors[f.id]}</div>
            {:else}
              <div class="muted small">Cargando…</div>
            {/if}
          </Sheet>
        {/if}
      </li>
    {/each}
  </ul>
{/if}
