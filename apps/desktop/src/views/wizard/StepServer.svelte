<script lang="ts">
  // URL del servidor, o "Este equipo es el servidor": detecta el login, lo confirma,
  // arranca `devi server --admin <login>` y comprueba `tailscale serve`.
  import ServeHint from "../../components/ServeHint.svelte";
  import { errorMessage } from "../../lib/api";
  import { useApp } from "../../lib/context";
  import { normalizeServerUrl } from "../../lib/format";
  import type { TailscaleSelf } from "../../lib/native";

  type Props = {
    self: TailscaleSelf | null;
    initialUrl: string;
    initialServerMode: boolean;
    onNext: (p: { serverUrl: string; serverAdminLogin?: string }) => void;
    onBack: () => void;
  };
  let { self, initialUrl, initialServerMode, onNext, onBack }: Props = $props();
  const app = useApp();

  // Valores iniciales: el asistente monta este paso de nuevo cada vez que se entra en él.
  // svelte-ignore state_referenced_locally
  let mode = $state<"remote" | "server">(initialServerMode ? "server" : "remote");
  // svelte-ignore state_referenced_locally
  let url = $state(initialUrl);
  let urlError = $state<string | null>(null);
  let confirmed = $state(false);
  let serveOk = $state<boolean | null>(null);
  let busy = $state(false);
  let error = $state<string | null>(null);
  // El estado del sidecar vive en DeviApp: así Ajustes lo ve al terminar el asistente.
  const server = $derived(app.server);

  function nextRemote() {
    const r = normalizeServerUrl(url);
    if (!r.ok) {
      urlError = r.error;
      return;
    }
    onNext({ serverUrl: r.url });
  }

  async function checkServe() {
    error = null;
    try {
      serveOk = await app.native.tailscaleServeConfigured(4747);
    } catch (e) {
      error = errorMessage(e);
    }
  }

  async function startServer() {
    if (!self) return;
    busy = true;
    error = null;
    try {
      app.server = await app.native.startServer(self.login);
      await checkServe();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      busy = false;
    }
  }

  function nextServer() {
    if (!self) return;
    onNext({ serverUrl: `https://${self.dnsName}`, serverAdminLogin: self.login });
  }
</script>

<section class="card">
  <div class="card-kicker">Paso 2 de 5 · Servidor</div>
  <div class="card-title">¿Dónde está el servidor de Devi?</div>
  <div class="radio-group">
    <label class="check"><input type="radio" bind:group={mode} value="remote" /> Me conecto al servidor de mi equipo</label>
    <label class="check"><input type="radio" bind:group={mode} value="server" /> Este equipo es el servidor</label>
  </div>

  {#if mode === "remote"}
    <div class="field">
      <label for="wiz-url">URL del servidor</label>
      <input id="wiz-url" type="url" bind:value={url} placeholder="https://pc.tu-tailnet.ts.net" />
    </div>
    <p class="muted small">Te la da quien administra Devi en tu equipo.</p>
    {#if urlError}<div class="error">{urlError}</div>{/if}
    <div class="actions">
      <button class="primary" onclick={nextRemote}>Continuar</button>
      <button onclick={onBack}>Atrás</button>
    </div>
  {:else if !self}
    <p class="error">Para el modo servidor necesitas Tailscale conectado en este equipo (paso 1).</p>
    <div class="actions"><button onclick={onBack}>Atrás</button></div>
  {:else}
    <p>Tu login de Tailscale es <span class="mono">{self.login}</span>. Serás el primer admin de Devi.</p>
    {#if !server?.running}
      <label class="check"><input type="checkbox" bind:checked={confirmed} /> Sí, soy yo</label>
      <div class="actions">
        <button class="primary" disabled={!confirmed || busy} onclick={startServer}>
          {busy ? "Arrancando…" : "Arrancar el servidor"}
        </button>
        <button onclick={onBack}>Atrás</button>
      </div>
    {:else}
      <p class="ok-text">Servidor en marcha (PID {server.pid}).</p>
      {#if serveOk === null}
        <div class="actions"><button onclick={checkServe}>Comprobar la publicación en la tailnet</button></div>
      {:else if serveOk === false}
        <ServeHint />
        <div class="actions"><button onclick={checkServe}>Ya lo ejecuté, comprobar de nuevo</button></div>
      {:else}
        <p class="muted small">Publicado en <span class="mono">https://{self.dnsName}</span></p>
        <div class="actions">
          <button class="primary" onclick={nextServer}>Continuar</button>
          <button onclick={onBack}>Atrás</button>
        </div>
      {/if}
    {/if}
    {#if server && !server.running && server.log.length > 0}
      <pre class="preview">{server.log.slice(-15).join("\n")}</pre>
    {/if}
  {/if}
  {#if error}<div class="error">{error}</div>{/if}
</section>
