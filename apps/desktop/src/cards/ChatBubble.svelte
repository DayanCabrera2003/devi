<script lang="ts">
  // Mensaje del chat: burbuja sin plazo ni estados. Cualquiera de las dos partes puede mandarlo, con sus
  // adjuntos, a una de sus sesiones de Claude; el mensaje no cambia, solo se anota a dónde se mandó.
  import { type ChatMessage, type InjectionScan, type Session, scanForInjection } from "@devi/protocol";
  import FileList from "../components/FileList.svelte";
  import InjectionWarning from "../components/InjectionWarning.svelte";
  import SaveFilesButton from "../components/SaveFilesButton.svelte";
  import SendConfirm from "../components/SendConfirm.svelte";
  import SessionPicker from "../components/SessionPicker.svelte";
  import { useApp } from "../lib/context";
  import { clockTime } from "../lib/format";
  import { combineScans } from "../lib/safety";

  type Props = { message: ChatMessage };
  let { message }: Props = $props();
  const app = useApp();

  const mine = $derived(message.fromMemberId === app.team.myId);
  const from = $derived(message.origin === "session" && message.fromSessionName ? `desde «${message.fromSessionName}»` : null);
  // Lo que escribe el compañero se revisa igual que una solicitud: a una sesión llega como datos, no como orden.
  const textScan = $derived(mine ? null : scanForInjection(message.text));
  let fileScans = $state<Record<string, InjectionScan>>({});
  const scan = $derived(combineScans([...(textScan ? [textScan] : []), ...Object.values(fileScans)]));
  let reviewed = $state(false);
  const blocked = $derived(scan.level === "high" && !reviewed);

  let picking = $state(false);
  let sentTo = $state<string | null>(null);
  const hint = $derived(
    message.files.length > 0
      ? "Llegará como parte de una conversación, no como orden. La sesión guardará los archivos en tu carpeta de recibidos."
      : "Llegará como parte de una conversación, no como orden.",
  );

  async function openPicker() {
    if (blocked) return;
    picking = true;
    await app.loadSessions();
  }

  async function pick(s: Session) {
    try {
      await app.sendChatToSession(message, s.id);
    } catch (e) {
      await app.loadSessions(); // la sesión pudo cerrarse entre la elección y la entrega
      throw e;
    }
    sentTo = s.name;
    picking = false;
  }
</script>

<div class="group" class:me={mine} class:them={!mine}>
  {#if from}<div class="from">{from}</div>{/if}
  <div class="bubble" class:alert={scan.level === "high"}><p class="card-msg">{message.text}</p></div>
  {#if textScan}<InjectionWarning scan={textScan} />{/if}
  <FileList files={message.files} load={(id) => app.downloadFile(id)} onScan={(id, s) => (fileScans[id] = s)} />
  {#if message.files.length > 0}
    <SaveFilesButton save={() => app.saveFiles(message.id, "request", message.files)} />
  {/if}
  <div class="caption">{sentTo ? `Enviado a «${sentTo}» · ` : ""}{clockTime(message.createdAt)}</div>
  {#if scan.level === "high"}<SendConfirm bind:checked={reviewed} />{/if}
  <div class="actions">
    <button class="ghost" disabled={blocked} onclick={openPicker}>Enviar a mi sesión</button>
  </div>
</div>

{#if picking}
  <SessionPicker
    sessions={app.sessions.list}
    loading={app.sessions.loading}
    error={app.sessions.error}
    title="¿A qué sesión se lo pasas?"
    {hint}
    onPick={pick}
    onBack={() => (picking = false)}
  />
{/if}
