<script lang="ts">
  // «Abrir en sesión nueva»: un código de entrega para el traspaso, que se pega como primer mensaje en una sesión nueva.
  import { useApp } from "../lib/context";
  import { copyText } from "../lib/handoff";
  import NewSessionClaim from "./NewSessionClaim.svelte";

  type Props = { requestId: string; inline?: boolean };
  let { requestId, inline = false }: Props = $props();
  const app = useApp();

  let open = $state(false);
</script>

<button onclick={() => (open = true)}>Abrir en sesión nueva</button>
{#if open}
  <div class="handoff-start">
    <NewSessionClaim
      target={{ type: "request", id: requestId }}
      create={(t) => app.createClaim(t)}
      cancel={(c) => app.cancelClaim(c)}
      copy={copyText}
      onBack={() => (open = false)}
      {inline}
    />
  </div>
{/if}

<style>
  /* En la fila de acciones: va al final y ocupa una línea entera. */
  .handoff-start { flex-basis: 100%; order: 99; }
</style>
