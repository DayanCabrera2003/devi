<script lang="ts">
  // "Claude quiere enviar esto a María": nada sale de este equipo hasta que se autoriza.
  import type { Draft } from "@devi/protocol";
  import FileList from "../components/FileList.svelte";
  import { errorMessage } from "../lib/api";
  import { useApp } from "../lib/context";

  type Props = { draft: Draft };
  let { draft }: Props = $props();
  const app = useApp();

  let busy = $state(false);
  let error = $state<string | null>(null);
  const title = $derived(
    draft.kind === "request"
      ? `Claude quiere enviar esto a ${app.team.nameOf(draft.toMemberId)}`
      : "Claude quiere enviar esta respuesta",
  );
  const minutesLeft = $derived(Math.max(0, Math.round((draft.expiresAt - Date.now()) / 60_000)));

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
  <div class="card-kicker">Borrador · necesita tu autorización</div>
  <div class="card-title">{title}</div>
  <div class="card-from">Nada sale de tu equipo hasta que lo autorices. Caduca en {minutesLeft} min.</div>
  <p class="card-msg">{draft.message}</p>
  <FileList files={draft.files} load={(id) => app.downloadFile(id)} />
  <div class="actions">
    <button class="primary" disabled={busy} onclick={() => run(() => app.authorizeDraft(draft))}>Autorizar</button>
    <button class="no" disabled={busy} onclick={() => run(() => app.discardDraft(draft))}>Descartar</button>
  </div>
  {#if error}<div class="error">{error}</div>{/if}
</div>
