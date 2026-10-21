<script lang="ts">
  // Carpeta de recibidos (receivedDir en config.json), la misma que usa el MCP de cada sesión.
  // El selector de carpeta lo abre Rust (choose_received_dir): el webview nunca aporta la ruta.
  import { errorMessage } from "../../lib/api";
  import { useApp } from "../../lib/context";

  const app = useApp();
  let busy = $state(false);
  let error = $state<string | null>(null);
  const current = $derived(app.config?.receivedDir ?? null);

  async function run(fn: () => Promise<void>) {
    busy = true;
    error = null;
    try {
      await fn();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      busy = false;
    }
  }
</script>

<section class="card">
  <div class="card-kicker">Archivos recibidos</div>
  <p class="mono small">{current ?? "~/Devi/recibidos (por defecto)"}</p>
  <p class="muted small">
    Cada solicitud guarda sus archivos en una subcarpeta propia (y los de la respuesta en «respuesta/»). Tus sesiones de
    Claude Code usan esta misma carpeta.
  </p>
  <div class="actions">
    <button disabled={busy} onclick={() => run(() => app.chooseReceivedDir())}>Cambiar…</button>
    {#if current}
      <button class="ghost" disabled={busy} onclick={() => run(() => app.resetReceivedDir())}>Usar la de por defecto</button>
    {/if}
  </div>
  {#if error}<div class="error">{error}</div>{/if}
</section>
