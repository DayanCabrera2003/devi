<script lang="ts">
  // Barra flotante para escribir a un compañero desde la app: mensaje del chat o solicitud, adjuntos, aviso de
  // secretos y envío.
  import { FILE_LIMITS } from "@devi/protocol";
  import Icon from "../../components/Icon.svelte";
  import Sheet from "../../components/Sheet.svelte";
  import { errorMessage } from "../../lib/api";
  import { useApp } from "../../lib/context";
  import type { PickedFile } from "../../lib/conversations-api";
  import { formatBytes } from "../../lib/format";

  type Props = { name: string };
  let { name }: Props = $props();
  const app = useApp();
  const c = $derived(app.composer);

  let field: HTMLTextAreaElement;
  let previewing = $state<PickedFile | null>(null);
  let pickError = $state<string | null>(null);

  // El campo crece con el texto hasta un máximo (luego hace scroll).
  function grow() {
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${Math.min(field.scrollHeight, 160)}px`;
  }
  $effect(() => {
    void c.text;
    grow();
  });
  // Con la fuente cargada o con otro ancho, las líneas miden otra cosa.
  $effect(() => {
    void document.fonts?.ready.then(grow);
    if (!field || typeof ResizeObserver === "undefined") return;
    let width = field.clientWidth;
    const ro = new ResizeObserver(() => {
      if (field.clientWidth === width) return;
      width = field.clientWidth;
      grow();
    });
    ro.observe(field);
    return () => ro.disconnect();
  });

  function removeFile(token: string) {
    if (previewing?.token === token) previewing = null;
    void c.remove(app.files, token);
  }

  async function pick() {
    pickError = null;
    try {
      await app.pickFiles();
    } catch (e) {
      pickError = errorMessage(e);
    }
  }

  async function send() {
    await app.sendMessage().catch((e) => (c.error = errorMessage(e)));
    field?.focus();
  }

  // Enter envía y Shift+Enter hace salto de línea. Mientras un IME compone (tildes muertas, CJK),
  // Enter confirma la composición y no debe enviar.
  function onKey(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      if (c.canSend) void send();
    }
  }

  const mb = FILE_LIMITS.maxBytes / 1_048_576;
  const label = $derived(c.mode === "message" ? `Mensaje para ${name}` : `Solicitud para ${name}`);
</script>

<div class="composer glass">
  {#if c.files.length > 0}
    <div class="chips">
      {#each c.files as f (f.token)}
        <span class="chip-file">
          <button title="Ver {f.name} ({formatBytes(f.size)})" onclick={() => (previewing = f)}>{f.name}</button>
          <button aria-label="Quitar {f.name}" onclick={() => removeFile(f.token)}><Icon name="close" /></button>
        </span>
      {/each}
    </div>
  {/if}
  {#if c.rejected.length > 0}
    <div class="composer-note warn">
      {#each c.rejected as r (r.name)}<div>No se adjuntó {r.name}: {r.reason}</div>{/each}
    </div>
  {/if}
  {#if c.secrets.length > 0}
    <div class="composer-note warn" role="alert">
      Parece que hay un secreto ({c.secrets.map((s) => `${s.label} en ${s.where}`).join("; ")}). Si lo envías, lo verá {name}.
      <label class="check"><input type="checkbox" bind:checked={app.composer.confirmSecrets} /> Enviar de todos modos</label>
    </div>
  {/if}
  <div class="composer-mode" role="radiogroup" aria-label="Qué envías">
    <label title="Un mensaje del chat: sin plazo ni respuesta que esperar">
      <input type="radio" name="composer-mode" value="message" bind:group={app.composer.mode} disabled={c.sending} /> Mensaje
    </label>
    <label title="Una solicitud: tiene plazo y {name} la acepta, la rechaza o la pasa a su Claude">
      <input type="radio" name="composer-mode" value="request" bind:group={app.composer.mode} disabled={c.sending} /> Solicitud
    </label>
  </div>
  <div class="composer-row">
    <button class="round add" aria-label="Adjuntar archivos" title="Adjuntar (archivos de texto, hasta {FILE_LIMITS.maxFiles} de {mb} MB)" disabled={c.sending || c.files.length >= FILE_LIMITS.maxFiles} onclick={pick}>
      <Icon name="plus" />
    </button>
    <textarea
      bind:this={field}
      bind:value={app.composer.text}
      rows="1"
      placeholder={label}
      aria-label={label}
      onkeydown={onKey}
      disabled={c.sending}
    ></textarea>
    <button class="round send" aria-label="Enviar" title="Enviar (Enter; Shift + Enter para otra línea)" disabled={!c.canSend} onclick={send}>
      <Icon name="up" />
    </button>
  </div>
  {#if c.error ?? pickError}<div class="composer-note error">{c.error ?? pickError}</div>{/if}
</div>

{#if previewing}
  <Sheet title={previewing.name} wide onClose={() => (previewing = null)}>
    <p class="sheet-sub">{formatBytes(previewing.size)} · vista previa</p>
    <pre class="preview">{previewing.preview}</pre>
  </Sheet>
{/if}
