<script lang="ts">
  // URL, versión, conectados, timeout de solicitudes, retención de archivos y copia de devi.db.
  import { onMount } from "svelte";
  import { errorMessage } from "../../lib/api";
  import { useApp } from "../../lib/context";
  import { SETTINGS_BOUNDS, type SettingsForm, formFromSettings, settingsFromForm } from "../../lib/format";

  const app = useApp();

  let version = $state<string | null>(null);
  let sessionsCount = $state<number | null>(null);
  let form = $state<SettingsForm | null>(null);
  let fieldErrors = $state<Partial<Record<keyof SettingsForm, string>>>({});
  let loading = $state(false);
  let saving = $state(false);
  let exporting = $state(false);
  let msg = $state<string | null>(null);
  let loadError = $state<string | null>(null);
  let saveError = $state<string | null>(null);
  let exportError = $state<string | null>(null);
  let exportPath = $state<string | null>(null);

  const fields: { key: keyof SettingsForm; label: string }[] = [
    { key: "timeoutMin", label: "Timeout de una solicitud sin respuesta (minutos)" },
    { key: "draftMin", label: "Tiempo para autorizar un borrador (minutos)" },
    { key: "retentionDays", label: "Borrar archivos tras cerrar la solicitud (días)" },
    { key: "maxAgeDays", label: "Borrar archivos siempre a partir de (días desde la subida)" },
  ];

  async function load() {
    loading = true;
    loadError = null;
    try {
      // admin() recarga también el equipo: el recuento de conectados queda al día.
      const [health, s] = await Promise.all([app.call((a) => a.health()), app.admin((a) => a.getSettings())]);
      version = health.version;
      form = formFromSettings(s);
      fieldErrors = {};
      const connected = app.team.team.members.filter((m) => m.connected && !m.disabled);
      const lists = await Promise.all(connected.map((m) => app.call((a) => a.memberSessions(m.id))));
      sessionsCount = lists.reduce((n, l) => n + l.length, 0);
    } catch (e) {
      loadError = errorMessage(e);
    } finally {
      loading = false;
    }
  }

  async function save(e: SubmitEvent) {
    e.preventDefault();
    if (!form) return;
    msg = null;
    saveError = null;
    const r = settingsFromForm($state.snapshot(form));
    if (!r.ok) {
      fieldErrors = r.errors;
      return;
    }
    fieldErrors = {};
    saving = true;
    try {
      form = formFromSettings(await app.call((a) => a.updateSettings(r.settings)));
      msg = "Ajustes guardados.";
    } catch (err) {
      saveError = errorMessage(err); // p. ej. el 400 del servidor con el campo que no acepta
    } finally {
      saving = false;
    }
  }

  async function exportDb() {
    exporting = true;
    exportError = null;
    exportPath = null;
    try {
      const bytes = await app.call((a) => a.exportDb());
      exportPath = await app.native.saveDbExport(bytes);
    } catch (e) {
      exportError = errorMessage(e);
    } finally {
      exporting = false;
    }
  }

  onMount(() => {
    void load();
  });
</script>

<section class="card">
  <div class="card-kicker">Servidor</div>
  <p class="mono small">{app.config?.serverUrl}</p>
  <div class="stats">
    <div class="stat"><span class="muted small">Versión</span><b>{version ?? "…"}</b></div>
    <div class="stat"><span class="muted small">Personas conectadas</span><b>{app.team.connectedCount}</b></div>
    <div class="stat"><span class="muted small">Sesiones abiertas</span><b>{sessionsCount ?? "…"}</b></div>
  </div>
  <div class="actions"><button class="ghost" disabled={loading} onclick={load}>Actualizar</button></div>
  {#if loadError}<div class="error">{loadError}</div>{/if}
</section>

{#if form}
  <form class="card" onsubmit={save} novalidate>
    <div class="card-kicker">Tiempos y retención</div>
    {#each fields as f (f.key)}
      {@const b = SETTINGS_BOUNDS[f.key]}
      <div class="field">
        <label for={`s-${f.key}`}>{f.label}</label>
        <input
          id={`s-${f.key}`}
          type="number"
          min={b.min}
          max={b.max}
          step="1"
          bind:value={form[f.key]}
          oninput={() => (msg = null)}
          aria-invalid={fieldErrors[f.key] ? "true" : undefined}
        />
        {#if fieldErrors[f.key]}
          <span class="error">{fieldErrors[f.key]}</span>
        {:else}
          <span class="muted small">{b.range.charAt(0).toUpperCase() + b.range.slice(1)}.</span>
        {/if}
      </div>
    {/each}
    <div class="actions"><button class="primary" type="submit" disabled={saving}>Guardar</button></div>
    {#if msg}<div class="ok-text">{msg}</div>{/if}
    {#if saveError}<div class="error">{saveError}</div>{/if}
  </form>
{/if}

<section class="card">
  <div class="card-kicker">Copia de seguridad</div>
  <p class="muted small">Descarga una copia de devi.db (personas, roles, solicitudes) en tu carpeta de Descargas.</p>
  <div class="actions"><button disabled={exporting} onclick={exportDb}>{exporting ? "Exportando…" : "Exportar devi.db"}</button></div>
  {#if exportPath}<p class="ok-text">Guardada en <span class="mono">{exportPath}</span></p>{/if}
  {#if exportError}<div class="error">{exportError}</div>{/if}
</section>
