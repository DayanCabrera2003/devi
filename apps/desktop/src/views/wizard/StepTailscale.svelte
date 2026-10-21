<script lang="ts">
  import { onMount } from "svelte";
  import { errorMessage } from "../../lib/api";
  import { useApp } from "../../lib/context";
  import type { TailscaleSelf } from "../../lib/native";

  // devUser solo en modo desarrollo: el servidor --dev identifica por la cabecera X-Devi-Dev-User.
  type Props = { onNext: (self: TailscaleSelf | null, devUser?: string) => void };
  let { onNext }: Props = $props();
  const app = useApp();

  let status = $state<"checking" | "ok" | "error">("checking");
  let self = $state<TailscaleSelf | null>(null);
  let error = $state("");
  let devUser = $state("");

  async function check() {
    status = "checking";
    try {
      self = await app.native.tailscaleSelf();
      status = "ok";
    } catch (e) {
      error = errorMessage(e);
      status = "error";
    }
  }

  onMount(() => {
    void check();
  });
</script>

<section class="card">
  <div class="card-kicker">Paso 1 de 5 · Tailscale</div>
  <div class="card-title">Comprobando Tailscale</div>
  {#if status === "checking"}
    <p class="muted">Buscando Tailscale en este equipo…</p>
  {:else if status === "ok" && self}
    <p>Conectado como <span class="mono">{self.login}</span></p>
    {#if self.dnsName}<p class="muted small">Este equipo: <span class="mono">{self.dnsName}</span></p>{/if}
  {:else}
    <p class="error">{error}</p>
    <p class="muted small">
      Devi usa Tailscale para saber quién eres y para llegar al servidor del equipo. Instálalo desde
      tailscale.com/download, inicia sesión con la cuenta del equipo y pulsa Reintentar.
    </p>
    <details>
      <summary class="muted small">Modo desarrollo (servidor local con --dev)</summary>
      <div class="field">
        <label for="dev-user">Usuario de desarrollo (cabecera X-Devi-Dev-User)</label>
        <input id="dev-user" bind:value={devUser} placeholder="dayan@dev" autocomplete="off" />
      </div>
    </details>
  {/if}
  <div class="actions">
    {#if status === "ok"}
      <button class="primary" onclick={() => onNext(self)}>Continuar</button>
    {:else}
      <button disabled={status === "checking"} onclick={check}>Reintentar</button>
      <button class="ghost" disabled={!devUser.trim()} onclick={() => onNext(null, devUser.trim())}>
        Continuar sin Tailscale (modo desarrollo)
      </button>
    {/if}
  </div>
</section>
