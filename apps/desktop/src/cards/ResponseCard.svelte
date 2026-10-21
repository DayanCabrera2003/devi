<script lang="ts">
  import type { DeviRequest, Session } from "@devi/protocol";
  import FileList from "../components/FileList.svelte";
  import SaveFilesButton from "../components/SaveFilesButton.svelte";
  import SessionPicker from "../components/SessionPicker.svelte";
  import { errorMessage } from "../lib/api";
  import { useApp } from "../lib/context";
  import { OUTCOME } from "../lib/format";

  type Props = { request: DeviRequest };
  let { request }: Props = $props();
  const app = useApp();

  let mode = $state<"view" | "pick">("view");
  let busy = $state(false);
  let error = $state<string | null>(null);
  const outcome = $derived(OUTCOME[request.outcome ?? "answered"]);
  const to = $derived(app.team.nameOf(request.toMemberId));

  // Las sesiones se piden al abrir el selector, no al montar cada tarjeta.
  let loadingSessions = $state(false);

  async function openPicker() {
    if (loadingSessions) return;
    loadingSessions = true;
    try {
      await app.loadSessions();
    } finally {
      loadingSessions = false;
    }
    mode = "pick";
  }

  async function acceptIt() {
    busy = true;
    error = null;
    try {
      await app.acceptResponse(request);
    } catch (e) {
      error = errorMessage(e);
      busy = false;
    }
  }

  async function pick(s: Session) {
    try {
      await app.forwardResponse(request, s.id);
    } catch (e) {
      await app.loadSessions();
      throw e;
    }
  }
</script>

{#if mode === "pick"}
  <SessionPicker
    sessions={app.sessions.list}
    loading={app.sessions.loading}
    error={app.sessions.error}
    title="¿A qué sesión se la pasas?"
    hint="Resaltada: la sesión que hizo la solicitud, si sigue abierta."
    preferredId={request.fromSessionId}
    onPick={pick}
    onBack={() => (mode = "view")}
  />
{:else}
  <div class="card">
    <div class="card-kicker">Respuesta · <span class="badge {outcome.cls}">{outcome.label}</span></div>
    <div class="card-title">Respuesta de {to}</div>
    <div class="card-from">a: <span class="muted">“{request.message}”</span></div>
    <p class="card-msg"><span class="muted">{outcome.lead}</span> {request.outcomeText ?? ""}</p>
    <FileList files={request.responseFiles} load={(id) => app.downloadFile(id)} />
    {#if request.responseFiles.length > 0}
      <SaveFilesButton save={() => app.saveFiles(request.id, "response", request.responseFiles)} />
    {/if}
    <div class="actions">
      <button class="primary" disabled={loadingSessions} onclick={openPicker}>
        {loadingSessions ? "Buscando sesiones…" : "Enviar a sesión"}
      </button>
      <button class="ok" disabled={busy} onclick={acceptIt}>Aceptar</button>
    </div>
    {#if error}<div class="error">{error}</div>{/if}
  </div>
{/if}
