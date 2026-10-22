<script lang="ts">
  import type { Me } from "@devi/protocol";
  import { onMount } from "svelte";
  import { type ErrorInfo, classifyError } from "../../lib/api";
  import { useApp } from "../../lib/context";
  import type { ClientConfig } from "../../lib/native";

  type Props = { config: ClientConfig; onNext: () => void; onBack: () => void };
  let { config, onNext, onBack }: Props = $props();
  const app = useApp();

  let status = $state<"testing" | "ok" | "error">("testing");
  let me = $state<Me | null>(null);
  let err = $state<ErrorInfo | null>(null);

  async function test() {
    status = "testing";
    err = null;
    try {
      me = await app.makeApi(config).me();
      // Se guarda ya (setupDone: false) para que install-integration y doctor vean el servidor.
      await app.saveWizardConfig(config);
      status = "ok";
    } catch (e) {
      err = classifyError(e);
      status = "error";
    }
  }

  onMount(() => {
    void test();
  });
</script>

<section class="card glass">
  <div class="card-kicker">Paso 3 de 5 · Conexión</div>
  <div class="card-title">Probando la conexión</div>
  <p class="mono small">{config.serverUrl}</p>
  {#if status === "testing"}
    <p class="muted">Conectando con el servidor…</p>
  {:else if status === "ok" && me}
    <p>Conectado como <strong>{me.member.name}</strong> (<span class="mono">{me.login}</span>).</p>
    <p class="muted small">Configuración guardada.</p>
    <div>
      {#each me.roles as r (r.id)}<span class="chip" style:--role={r.color}>{r.name}</span>{/each}
    </div>
  {:else if err?.kind === "unknown_login"}
    <p>El servidor responde, pero tu login aún no está en el equipo:</p>
    <p class="code">{err.login}</p>
    <p class="muted small">Pide al admin que te añada con ese login (Admin → Personas → Invitar) y pulsa Reintentar.</p>
  {:else if err}
    <p class="error">{err.message}</p>
    <p class="muted small">Si acabas de arrancar el servidor, espera unos segundos y reintenta.</p>
  {/if}
  <div class="actions">
    {#if status === "ok"}<button class="primary" onclick={onNext}>Continuar</button>{/if}
    {#if status === "error"}<button onclick={test}>Reintentar</button>{/if}
    <button onclick={onBack}>Atrás</button>
  </div>
</section>
