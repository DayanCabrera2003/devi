<script lang="ts">
  import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
  import { onMount } from "svelte";
  import DeviCommand from "../components/DeviCommand.svelte";
  import { errorMessage } from "../lib/api";
  import { useApp } from "../lib/context";
  import { normalizeServerUrl } from "../lib/format";
  import FolderSetting from "./settings/FolderSetting.svelte";
  import LocalServerPanel from "./settings/LocalServerPanel.svelte";

  const app = useApp();
  let url = $state(app.config?.serverUrl ?? "");
  let urlMsg = $state<{ ok: boolean; text: string } | null>(null);
  let autostart = $state(false);
  let autostartError = $state<string | null>(null);

  onMount(() => {
    isEnabled()
      .then((v) => (autostart = v))
      .catch((e) => (autostartError = errorMessage(e)));
  });

  async function saveUrl() {
    const r = normalizeServerUrl(url);
    if (!r.ok) {
      urlMsg = { ok: false, text: r.error };
      return;
    }
    url = r.url;
    try {
      await app.changeServer(r.url);
      urlMsg = { ok: true, text: "Guardado. Reconectando…" };
    } catch (e) {
      urlMsg = { ok: false, text: errorMessage(e) };
    }
  }

  async function toggleAutostart(on: boolean) {
    autostartError = null;
    try {
      if (on) await enable();
      else await disable();
      autostart = await isEnabled();
    } catch (e) {
      autostartError = errorMessage(e);
    }
  }
</script>

<section class="card">
  <div class="card-kicker">Servidor</div>
  <div class="field">
    <label for="set-url">URL del servidor de Devi</label>
    <input id="set-url" type="url" bind:value={url} placeholder="https://pc.tu-tailnet.ts.net" />
  </div>
  <div class="actions">
    <button class="primary" disabled={url.trim() === (app.config?.serverUrl ?? "")} onclick={saveUrl}>
      Guardar y reconectar
    </button>
  </div>
  {#if urlMsg}<div class={urlMsg.ok ? "ok-text" : "error"}>{urlMsg.text}</div>{/if}
</section>

<section class="card">
  <div class="card-kicker">Avisos y arranque</div>
  <label class="check">
    <input
      type="checkbox"
      checked={app.prefs.notifications}
      onchange={(e) => app.updatePrefs({ notifications: e.currentTarget.checked })}
    />
    Notificaciones del sistema
  </label>
  <label class="check">
    <input type="checkbox" checked={app.paused} onchange={(e) => app.togglePause(e.currentTarget.checked)} />
    Pausar avisos por ahora
  </label>
  <label class="check">
    <input type="checkbox" checked={autostart} onchange={(e) => toggleAutostart(e.currentTarget.checked)} />
    Abrir Devi al iniciar sesión
  </label>
  {#if autostartError}<div class="error">{autostartError}</div>{/if}
</section>

<FolderSetting />

{#if app.prefs.serverAdminLogin}
  <LocalServerPanel />
{/if}

<section class="card">
  <div class="card-kicker">Claude Code</div>
  <DeviCommand args={["install-integration"]} label="Reinstalar la integración" />
  <DeviCommand args={["doctor"]} label="Diagnóstico (devi doctor)" />
</section>

<section class="card">
  <div class="card-kicker">Asistente</div>
  <p class="muted small">Vuelve a elegir servidor, comprobar Tailscale o instalar la integración.</p>
  <div class="actions"><button onclick={() => app.restartWizard()}>Volver a ejecutar el asistente</button></div>
</section>
