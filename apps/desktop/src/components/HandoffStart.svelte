<script lang="ts">
  // «Empezar sesión con esto»: copia el comando que abre Claude Code con el traspaso y lo deja a la vista.
  import { copyText, handoffCommand } from "../lib/handoff";

  type Props = { requestId: string };
  let { requestId }: Props = $props();

  const command = $derived(handoffCommand(requestId));
  let copied = $state<boolean | null>(null);

  async function start() {
    copied = await copyText(command);
  }
</script>

<button onclick={start}>Empezar sesión con esto</button>
{#if copied !== null}
  <div class="handoff-start">
    <div class={copied ? "ok-text" : "hint"}>
      {copied
        ? "Copiado. Pégalo en una terminal, en la carpeta del proyecto:"
        : "No se pudo copiar; cópialo a mano y pégalo en una terminal, en la carpeta del proyecto:"}
    </div>
    <pre class="preview">{command}</pre>
  </div>
{/if}

<style>
  /* En la fila de acciones: va al final y ocupa una línea entera. */
  .handoff-start { flex-basis: 100%; order: 99; }
  .hint { font-size: 12.5px; margin-top: 6px; color: var(--label2); }
</style>
