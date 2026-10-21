<script lang="ts">
  // Archivos de una tarjeta con vista previa de texto (se lee del servidor; no se escribe a disco).
  import type { FileMeta } from "@devi/protocol";
  import { errorMessage } from "../lib/api";
  import { formatBytes } from "../lib/format";

  type Props = { files: FileMeta[]; load: (id: string) => Promise<string> };
  let { files, load }: Props = $props();

  let open = $state<string | null>(null);
  let contents = $state<Record<string, string>>({});
  let errors = $state<Record<string, string>>({});

  async function toggle(f: FileMeta) {
    if (open === f.id) {
      open = null;
      return;
    }
    open = f.id;
    if (contents[f.id] !== undefined) return;
    delete errors[f.id];
    try {
      contents[f.id] = await load(f.id);
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
