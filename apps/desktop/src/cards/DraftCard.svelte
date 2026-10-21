<script lang="ts">
  // "Claude quiere enviar esto a María": nada sale de este equipo hasta que se autoriza.
  import { type Draft, type InjectionScan, SECRETS_FLAG, hasSecretsFlag, scanForInjection } from "@devi/protocol";
  import FileList from "../components/FileList.svelte";
  import InjectionWarning from "../components/InjectionWarning.svelte";
  import { errorMessage } from "../lib/api";
  import { useApp } from "../lib/context";
  import { truncate } from "../lib/format";
  import { combineScans } from "../lib/safety";

  type Props = { draft: Draft };
  let { draft }: Props = $props();
  const app = useApp();

  let busy = $state(false);
  let error = $state<string | null>(null);
  // Respuesta: la solicitud original sale de la bandeja; si no está, no se pide al servidor.
  const original = $derived(draft.kind === "response" ? app.inbox.requestById(draft.requestId) : undefined);
  const title = $derived.by(() => {
    if (draft.kind === "request") return `Claude quiere enviar esto a ${app.team.nameOf(draft.toMemberId)}`;
    if (original) return `Respuesta a ${app.team.nameOf(original.fromMemberId)}`;
    return `Respuesta a la solicitud ${draft.requestId.slice(0, 8)}`;
  });
  const minutesLeft = $derived(Math.max(0, Math.round((draft.expiresAt - app.clock.now) / 60_000)));

  // El MCP marca con SECRETS_FLAG (primera línea) los borradores con posibles secretos que el usuario confirmó.
  const secrets = $derived(hasSecretsFlag(draft.message));
  const body = $derived(secrets ? draft.message.slice(SECRETS_FLAG.length).replace(/^\s+/, "") : draft.message);
  let fileScans = $state<Record<string, InjectionScan>>({});
  const scan = $derived(combineScans([scanForInjection(body), ...Object.values(fileScans)]));

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
  {#if original}
    <div class="card-from draft-context">Su solicitud: <span class="muted excerpt">“{truncate(original.message, 200)}”</span></div>
  {/if}
  {#if secrets}
    <div class="secrets" role="alert">
      <strong>{SECRETS_FLAG}.</strong> Devi detectó algo que parece un secreto (clave, token o contraseña) en el
      mensaje o en los archivos. Revísalo bien: si lo autorizas, lo verá tu compañero.
    </div>
  {/if}
  <InjectionWarning {scan} />
  <p class="card-msg">{body}</p>
  <FileList files={draft.files} load={(id) => app.downloadFile(id)} onScan={(id, s) => (fileScans[id] = s)} />
  <div class="actions">
    <button class="primary" disabled={busy} onclick={() => run(() => app.authorizeDraft(draft))}>Autorizar</button>
    <button class="no" disabled={busy} onclick={() => run(() => app.discardDraft(draft))}>Descartar</button>
  </div>
  {#if error}<div class="error">{error}</div>{/if}
</div>
