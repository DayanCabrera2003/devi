<script lang="ts">
  // Solicitud ya resuelta (o esperando al otro): burbujas y estado, sin acciones.
  import { scanForInjection } from "@devi/protocol";
  import FileList from "../components/FileList.svelte";
  import InjectionWarning from "../components/InjectionWarning.svelte";
  import { useApp } from "../lib/context";
  import type { ThreadRequest } from "../lib/conversations-api";
  import { canReassign } from "../lib/reassign";
  import { hasReplyBubble, originLabel, requestCaption } from "../lib/thread-items";
  import ReassignButton from "./ReassignButton.svelte";

  type Props = { request: ThreadRequest };
  let { request }: Props = $props();
  const app = useApp();

  const mine = $derived(request.fromMemberId === app.team.myId);
  const caption = $derived(requestCaption(request, app.team.myId));
  const reply = $derived(hasReplyBubble(request));
  // Lo que escribe el compañero se revisa igual que en las tarjetas abiertas.
  const askScan = $derived(mine ? null : scanForInjection(request.message));
  const replyScan = $derived(reply && mine ? scanForInjection(request.outcomeText ?? "") : null);
</script>

<div class="group" class:me={mine} class:them={!mine}>
  {#if !mine}<div class="from">{originLabel(request)}</div>{/if}
  <div class="bubble"><p class="card-msg">{request.message}</p></div>
  {#if askScan}<InjectionWarning scan={askScan} />{/if}
  <FileList files={request.files} load={(id) => app.downloadFile(id)} />
  {#if !reply}
    <div class="caption" class:good={caption.tone === "good"} class:bad={caption.tone === "bad"} class:warn={caption.tone === "warn"}>
      {caption.text}
    </div>
    {#if canReassign(request, app.team.myId)}
      <div class="actions"><ReassignButton {request} primary={request.escalatedAt !== undefined} /></div>
    {/if}
  {/if}
</div>
{#if reply}
  <div class="group tight" class:me={!mine} class:them={mine}>
    <div class="bubble"><p class="card-msg">{request.outcomeText}</p></div>
    {#if replyScan}<InjectionWarning scan={replyScan} />{/if}
    <FileList files={request.responseFiles} load={(id) => app.downloadFile(id)} />
    <div class="caption good">{caption.text}</div>
  </div>
{/if}
