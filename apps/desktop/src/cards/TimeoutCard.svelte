<script lang="ts">
  // Nadie actuó a tiempo: quien preguntó decide si reenviar o ignorar.
  import type { DeviRequest } from "@devi/protocol";
  import { errorMessage } from "../lib/api";
  import { useApp } from "../lib/context";
  import { waited } from "../lib/format";

  type Props = { request: DeviRequest };
  let { request }: Props = $props();
  const app = useApp();

  let busy = $state(false);
  let error = $state<string | null>(null);
  const to = $derived(app.team.nameOf(request.toMemberId));

  async function run(fn: () => Promise<void>) {
    busy = true;
    error = null;
    try {
      await fn();
    } catch (e) {
      error = errorMessage(e);
      busy = false;
    }
  }
</script>

<div class="card">
  <div class="card-kicker">Sin respuesta</div>
  <div class="card-title">{to} no respondió a tiempo</div>
  <div class="card-from">Pasó {waited(request)} sin que nadie actuara.</div>
  <p class="card-msg">{request.message}</p>
  <div class="actions">
    <button class="primary" disabled={busy} onclick={() => run(() => app.resend(request))}>Reenviar</button>
    <button disabled={busy} onclick={() => run(() => app.ignore(request))}>Ignorar</button>
  </div>
  {#if error}<div class="error">{error}</div>{/if}
</div>
