<script lang="ts">
  // Respuesta a una solicitud mía: mi burbuja, la suya justo después y qué hago con ella.
  import { type DeviRequest, type InjectionScan, type Session, scanForInjection } from "@devi/protocol";
  import FileList from "../components/FileList.svelte";
  import InjectionWarning from "../components/InjectionWarning.svelte";
  import SaveFilesButton from "../components/SaveFilesButton.svelte";
  import SendConfirm from "../components/SendConfirm.svelte";
  import SessionPicker from "../components/SessionPicker.svelte";
  import { errorMessage } from "../lib/api";
  import { useApp } from "../lib/context";
  import { OUTCOME } from "../lib/format";
  import { combineScans } from "../lib/safety";
  import { requestCaption } from "../lib/thread-items";

  type Props = { request: DeviRequest };
  let { request }: Props = $props();
  const app = useApp();

  let mode = $state<"view" | "pick">("view");
  let busy = $state(false);
  let error = $state<string | null>(null);
  const outcome = $derived(OUTCOME[request.outcome ?? "answered"]);
  const to = $derived(app.team.nameOf(request.toMemberId));
  const caption = $derived(requestCaption(request, app.team.myId));
  // Las solicitudes enviadas desde la app no tienen sesión de origen que resaltar.
  const fromApp = $derived(request.origin === "app" || !request.fromSessionId);

  // Las sesiones se piden al abrir el selector, no al montar cada tarjeta.
  let loadingSessions = $state(false);

  // Posible prompt injection: en el texto de la respuesta y en los archivos previsualizados.
  const messageScan = $derived(scanForInjection(request.outcomeText ?? ""));
  let fileScans = $state<Record<string, InjectionScan>>({});
  const scan = $derived(combineScans([messageScan, ...Object.values(fileScans)]));
  let reviewed = $state(false);
  const blocked = $derived(scan.level === "high" && !reviewed);

  async function openPicker() {
    if (loadingSessions || blocked) return;
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

<div class="group me">
  <div class="bubble"><p class="selectable" style="margin: 0; white-space: pre-wrap">{request.message}</p></div>
  <div class="caption" class:good={caption.tone === "good"} class:bad={caption.tone === "bad"}>{caption.text}</div>
</div>
<div class="group them tight">
  <div class="bubble" class:alert={scan.level === "high"}>
    <span class="bubble-label">{outcome.lead} <span class="sr-only">Respuesta de {to}</span></span>
    <p class="card-msg">{request.outcomeText ?? ""}</p>
  </div>
  <InjectionWarning scan={messageScan} />
  <FileList files={request.responseFiles} load={(id) => app.downloadFile(id)} onScan={(id, s) => (fileScans[id] = s)} />
  {#if request.responseFiles.length > 0}
    <SaveFilesButton save={() => app.saveFiles(request.id, "response", request.responseFiles)} />
  {/if}
  <div class="caption"><span class="badge {outcome.cls}">{outcome.label}</span></div>
  {#if scan.level === "high"}<SendConfirm bind:checked={reviewed} />{/if}
  <div class="actions">
    <button class="primary" disabled={busy} onclick={acceptIt}>Aceptar</button>
    <button disabled={loadingSessions || blocked} onclick={openPicker}>
      {loadingSessions ? "Buscando sesiones…" : "Enviar a mi sesión"}
    </button>
  </div>
  {#if error}<div class="error">{error}</div>{/if}
</div>

{#if mode === "pick"}
  <SessionPicker
    sessions={app.sessions.list}
    loading={app.sessions.loading}
    error={app.sessions.error}
    title="¿A qué sesión se la pasas?"
    hint={fromApp
      ? "La pediste desde la app: elige la sesión que debe recibir la respuesta."
      : "Resaltada: la sesión que hizo la solicitud, si sigue abierta."}
    preferredId={fromApp ? undefined : request.fromSessionId}
    onPick={pick}
    onBack={() => (mode = "view")}
  />
{/if}
