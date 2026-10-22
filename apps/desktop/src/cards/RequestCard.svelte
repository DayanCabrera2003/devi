<script lang="ts">
  // Solicitud entrante pendiente: burbuja del compañero y, debajo, lo que puedo hacer con ella.
  import { type DeviRequest, type InjectionScan, type Session, contextText, hasContext, scanForInjection } from "@devi/protocol";
  import ContextBlock from "../components/ContextBlock.svelte";
  import DecisionForm from "../components/DecisionForm.svelte";
  import FileList from "../components/FileList.svelte";
  import InjectionWarning from "../components/InjectionWarning.svelte";
  import SaveFilesButton from "../components/SaveFilesButton.svelte";
  import SendConfirm from "../components/SendConfirm.svelte";
  import SessionPicker from "../components/SessionPicker.svelte";
  import { useApp } from "../lib/context";
  import type { ThreadRequest } from "../lib/conversations-api";
  import { combineScans } from "../lib/safety";
  import { originLabel, requestCaption } from "../lib/thread-items";

  // compact: panel de avisos (formularios en línea y sin guardar en disco).
  type Props = { request: DeviRequest; compact?: boolean };
  let { request, compact = false }: Props = $props();
  const app = useApp();

  let mode = $state<"view" | "pick" | "accept" | "reject">("view");
  const from = $derived(app.team.nameOf(request.fromMemberId));
  const caption = $derived(requestCaption(request, app.team.myId));
  const hint = $derived(
    request.files.length > 0
      ? "Llegará como pregunta abierta, no como orden. La sesión guardará los archivos en tu carpeta de recibidos."
      : "Llegará como pregunta abierta, no como orden.",
  );

  // Posible prompt injection: en el mensaje y en los archivos que se hayan previsualizado.
  const messageScan = $derived(scanForInjection(request.message));
  const contextScan = $derived(scanForInjection(hasContext(request.context) ? contextText(request.context) : ""));
  let fileScans = $state<Record<string, InjectionScan>>({});
  const scan = $derived(combineScans([messageScan, contextScan, ...Object.values(fileScans)]));
  let reviewed = $state(false);
  const blocked = $derived(scan.level === "high" && !reviewed);

  async function openPicker() {
    if (blocked) return;
    mode = "pick";
    await app.loadSessions();
  }

  async function pick(s: Session) {
    try {
      await app.forward(request, s.id);
    } catch (e) {
      await app.loadSessions(); // la sesión pudo cerrarse entre la elección y la entrega
      throw e;
    }
  }
</script>

<div class="group them">
  <div class="from">{originLabel(request as ThreadRequest)}</div>
  <div class="bubble" class:alert={scan.level === "high"}>
    <span class="sr-only">{from} te pide algo:</span>
    <p class="card-msg">{request.message}</p>
  </div>
  <InjectionWarning scan={messageScan} />
  <ContextBlock context={request.context} />
  <InjectionWarning scan={contextScan} where="el contexto" />
  <FileList files={request.files} load={(id) => app.downloadFile(id)} onScan={(id, s) => (fileScans[id] = s)} />
  {#if !compact && request.files.length > 0}
    <SaveFilesButton save={() => app.saveFiles(request.id, "request", request.files)} />
  {/if}
  <div class="caption">{caption.text}</div>
  {#if scan.level === "high"}<SendConfirm bind:checked={reviewed} />{/if}
  <div class="actions">
    <button class="primary" disabled={blocked} onclick={openPicker}>Enviar a mi sesión</button>
    <button onclick={() => (mode = "accept")}>Lo hago yo</button>
    <button class="no" onclick={() => (mode = "reject")}>Rechazar</button>
  </div>
</div>

{#if mode === "pick"}
  <SessionPicker
    sessions={app.sessions.list}
    loading={app.sessions.loading}
    error={app.sessions.error}
    title="¿A qué sesión se lo pasas?"
    {hint}
    onPick={pick}
    onBack={() => (mode = "view")}
    inline={compact}
  />
{:else if mode === "accept"}
  <DecisionForm kind="accept" fromName={from} message={request.message} onConfirm={(t) => app.accept(request, t)} onBack={() => (mode = "view")} inline={compact} />
{:else if mode === "reject"}
  <DecisionForm kind="reject" fromName={from} message={request.message} onConfirm={(t) => app.reject(request, t)} onBack={() => (mode = "view")} inline={compact} />
{/if}
