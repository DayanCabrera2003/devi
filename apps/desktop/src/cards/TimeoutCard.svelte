<script lang="ts">
  // Nadie actuó a tiempo: quien preguntó decide si reenviar o ignorar.
  import type { DeviRequest } from "@devi/protocol";
  import { errorMessage } from "../lib/api";
  import { useApp } from "../lib/context";
  import { waited } from "../lib/format";
  import ReassignButton from "./ReassignButton.svelte";

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

<div class="group me">
  <div class="bubble"><p class="card-msg">{request.message}</p></div>
  <div class="caption warn">Sin respuesta · {to} no contestó en {waited(request)}</div>
  <div class="actions">
    <button class="primary" disabled={busy} onclick={() => run(() => app.resend(request))}>Reenviar</button>
    <button disabled={busy} onclick={() => run(() => app.ignore(request))}>Ignorar</button>
    <ReassignButton {request} />
  </div>
  {#if error}<div class="error">{error}</div>{/if}
</div>
