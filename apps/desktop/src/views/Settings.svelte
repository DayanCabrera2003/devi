<script lang="ts">
  // Ajustes agrupados como en Ajustes del Sistema de macOS.
  import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
  import { onMount } from "svelte";
  import DeviCommand from "../components/DeviCommand.svelte";
  import { errorMessage } from "../lib/api";
  import { useApp } from "../lib/context";
  import { normalizeServerUrl } from "../lib/format";
  import { THEME_OPTIONS, type ThemePref } from "../lib/theme";
  import Page from "./Page.svelte";
  import FolderSetting from "./settings/FolderSetting.svelte";
  import LocalServerPanel from "./settings/LocalServerPanel.svelte";
  import ShellAliasSetting from "./settings/ShellAliasSetting.svelte";

  const app = useApp();
  let url = $state(app.config?.serverUrl ?? "");
  let urlMsg = $state<{ ok: boolean; text: string } | null>(null);
  let autostart = $state(false);
  let prefsError = $state<string | null>(null);
  let themeError = $state<string | null>(null);
  const theme = $derived<ThemePref>(app.prefs.theme ?? "system");

  onMount(() => {
    isEnabled()
      .then((v) => (autostart = v))
      .catch((e) => (prefsError = errorMessage(e)));
  });

  // Si el cambio falla se muestra el error y la casilla vuelve al estado real
  // (el estado no cambió, así que Svelte no la repintaría por su cuenta).
  async function toggle(box: HTMLInputElement, fn: (on: boolean) => Promise<void>, real: () => boolean) {
    prefsError = null;
    try {
      await fn(box.checked);
    } catch (e) {
      prefsError = errorMessage(e);
    }
    box.checked = real();
  }

  async function setTheme(value: ThemePref) {
    themeError = null;
    try {
      await app.updatePrefs({ theme: value });
    } catch (e) {
      themeError = errorMessage(e);
    }
  }

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
    try {
      if (on) await enable();
      else await disable();
    } finally {
      autostart = await isEnabled().catch(() => autostart);
    }
  }
</script>

<Page title="Ajustes">
  <section class="group-box">
    <h2 class="group-title">Apariencia</h2>
    <div class="inset">
      <div class="cell">
        <span class="grow" id="theme-label">Tema</span>
        <div class="segmented" role="radiogroup" aria-labelledby="theme-label">
          {#each THEME_OPTIONS as o (o.value)}
            <label>
              <input type="radio" name="theme" value={o.value} checked={theme === o.value} onchange={() => setTheme(o.value)} />
              {o.label}
            </label>
          {/each}
        </div>
      </div>
    </div>
    {#if themeError}<div class="error">{themeError}</div>{/if}
  </section>

  <section class="group-box">
    <h2 class="group-title">Servidor</h2>
    <div class="inset">
      <div class="cell stack">
        <div class="field" style="margin: 0">
          <label for="set-url">URL del servidor de Devi</label>
          <input id="set-url" type="url" bind:value={url} placeholder="https://pc.tu-tailnet.ts.net" />
        </div>
        <div class="actions" style="margin: 0">
          <button class="primary" disabled={url.trim() === (app.config?.serverUrl ?? "")} onclick={saveUrl}>
            Guardar y reconectar
          </button>
        </div>
        {#if urlMsg}<div class={urlMsg.ok ? "ok-text" : "error"} style="margin: 0">{urlMsg.text}</div>{/if}
      </div>
    </div>
  </section>

  <section class="group-box">
    <h2 class="group-title">Avisos y arranque</h2>
    <div class="inset">
      <div class="cell">
        <label class="check">
          <input
            class="switch"
            type="checkbox"
            checked={app.prefs.notifications}
            onchange={(e) =>
              toggle(e.currentTarget, (on) => app.updatePrefs({ notifications: on }), () => app.prefs.notifications)}
          />
          Notificaciones del sistema
        </label>
      </div>
      <div class="cell">
        <label class="check">
          <input
            class="switch"
            type="checkbox"
            checked={app.paused}
            onchange={(e) => toggle(e.currentTarget, (on) => app.togglePause(on), () => app.paused)}
          />
          Pausar avisos por ahora
        </label>
      </div>
      <div class="cell">
        <label class="check">
          <input class="switch" type="checkbox" checked={autostart} onchange={(e) => toggle(e.currentTarget, toggleAutostart, () => autostart)} />
          Abrir Devi al iniciar sesión
        </label>
      </div>
    </div>
    {#if prefsError}<div class="error">{prefsError}</div>{/if}
  </section>

  <FolderSetting />

  {#if app.prefs.serverAdminLogin}
    <LocalServerPanel />
  {/if}

  <section class="group-box">
    <h2 class="group-title">Claude Code</h2>
    <div class="inset">
      <div class="cell stack"><DeviCommand args={["install-integration"]} label="Reinstalar la integración" /></div>
      <div class="cell stack"><DeviCommand args={["doctor"]} label="Diagnóstico (devi doctor)" /></div>
    </div>
  </section>

  <ShellAliasSetting />

  <section class="group-box">
    <h2 class="group-title">Asistente</h2>
    <div class="inset">
      <div class="cell">
        <span class="grow">Vuelve a elegir servidor, comprobar Tailscale o instalar la integración.</span>
        <button onclick={() => app.restartWizard()}>Volver a ejecutar el asistente</button>
      </div>
    </div>
  </section>
</Page>
