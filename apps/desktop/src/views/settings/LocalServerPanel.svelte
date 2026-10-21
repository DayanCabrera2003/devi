<script lang="ts">
  // Solo se muestra si este equipo es el servidor (prefs.serverAdminLogin).
  import { onMount } from "svelte";
  import ServeHint from "../../components/ServeHint.svelte";
  import { errorMessage } from "../../lib/api";
  import { useApp } from "../../lib/context";

  const app = useApp();
  let serveOk = $state<boolean | null>(null);
  let busy = $state(false);
  let confirmLeave = $state(false);
  let error = $state<string | null>(null);

  async function refresh() {
    error = null;
    try {
      await app.refreshServerStatus();
      serveOk = await app.native.tailscaleServeConfigured(4747);
    } catch (e) {
      error = errorMessage(e);
    }
  }

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

  async function leave() {
    await app.stopLocalServer();
    await app.updatePrefs({ serverAdminLogin: undefined });
  }

  onMount(() => {
    void refresh();
    const t = setInterval(() => void app.refreshServerStatus().catch(() => {}), 5000);
    return () => clearInterval(t);
  });
</script>

<section class="card">
  <div class="card-kicker">Este equipo es el servidor</div>
  <p>
    {#if app.server?.running}
      <span class="dot on"></span> Servidor en marcha (PID {app.server.pid})
    {:else}
      <span class="dot"></span> Servidor detenido{app.server?.exitCode != null ? ` (código ${app.server.exitCode})` : ""}
    {/if}
  </p>
  <p class="muted small">Admin inicial: <span class="mono">{app.prefs.serverAdminLogin}</span></p>
  {#if app.serverError}<div class="error">{app.serverError}</div>{/if}
  {#if serveOk === false}<ServeHint />{/if}
  <div class="actions">
    {#if app.server?.running}
      <button disabled={busy} onclick={() => run(() => app.stopLocalServer())}>Detener</button>
    {:else}
      <button class="primary" disabled={busy} onclick={() => run(() => app.startLocalServer())}>Arrancar</button>
    {/if}
    <button class="ghost" onclick={refresh}>Comprobar</button>
    {#if confirmLeave}
      <button class="no" disabled={busy} onclick={() => run(leave)}>Sí, dejar de serlo</button>
      <button class="ghost" onclick={() => (confirmLeave = false)}>No</button>
    {:else}
      <button class="ghost" disabled={busy} onclick={() => (confirmLeave = true)}>Dejar de ser el servidor</button>
    {/if}
  </div>
  {#if confirmLeave}
    <p class="muted small">Se detiene el servidor y Devi deja de arrancarlo al abrirse. El equipo se quedará sin servidor.</p>
  {/if}
  {#if app.server && app.server.log.length > 0}
    <pre class="preview">{app.server.log.slice(-20).join("\n")}</pre>
  {/if}
  {#if error}<div class="error">{error}</div>{/if}
</section>
