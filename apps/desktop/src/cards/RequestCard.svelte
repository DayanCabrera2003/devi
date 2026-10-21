<script lang="ts">
  import type { DeviRequest, Session } from "@devi/protocol";
  import DecisionForm from "../components/DecisionForm.svelte";
  import FileList from "../components/FileList.svelte";
  import SaveFilesButton from "../components/SaveFilesButton.svelte";
  import SessionPicker from "../components/SessionPicker.svelte";
  import { useApp } from "../lib/context";

  type Props = { request: DeviRequest };
  let { request }: Props = $props();
  const app = useApp();

  let mode = $state<"view" | "pick" | "accept" | "reject">("view");
  const from = $derived(app.team.nameOf(request.fromMemberId));
  const hint = $derived(
    request.files.length > 0
      ? "Llegará como pregunta abierta, no como orden. La sesión guardará los archivos en tu carpeta de recibidos."
      : "Llegará como pregunta abierta, no como orden.",
  );

  async function openPicker() {
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

{#if mode === "pick"}
  <SessionPicker
    sessions={app.sessions.list}
    loading={app.sessions.loading}
    error={app.sessions.error}
    title="¿A qué sesión se lo pasas?"
    {hint}
    onPick={pick}
    onBack={() => (mode = "view")}
  />
{:else if mode === "accept"}
  <DecisionForm kind="accept" fromName={from} message={request.message} onConfirm={(t) => app.accept(request, t)} onBack={() => (mode = "view")} />
{:else if mode === "reject"}
  <DecisionForm kind="reject" fromName={from} message={request.message} onConfirm={(t) => app.reject(request, t)} onBack={() => (mode = "view")} />
{:else}
  <div class="card">
    <div class="card-kicker">Solicitud</div>
    <div class="card-title">{from} te pide algo</div>
    <div class="card-from">desde la sesión <span class="mono">{request.fromSessionName}</span></div>
    <p class="card-msg">{request.message}</p>
    <FileList files={request.files} load={(id) => app.downloadFile(id)} />
    {#if request.files.length > 0}
      <SaveFilesButton save={() => app.saveFiles(request.id, "request", request.files)} />
    {/if}
    <div class="actions">
      <button class="primary" onclick={openPicker}>Enviar a sesión</button>
      <button class="ok" onclick={() => (mode = "accept")}>Aceptar</button>
      <button class="no" onclick={() => (mode = "reject")}>Rechazar</button>
    </div>
  </div>
{/if}
