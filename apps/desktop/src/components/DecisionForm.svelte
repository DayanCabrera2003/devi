<script lang="ts">
  // Lo hago yo (nota opcional) o Rechazar (motivo obligatorio), en una hoja sobre el hilo.
  import { errorMessage } from "../lib/api";
  import Sheet from "./Sheet.svelte";

  type Props = {
    kind: "accept" | "reject";
    fromName: string;
    message: string;
    onConfirm: (text: string) => Promise<void>;
    onBack: () => void;
  };
  let { kind, fromName, message, onConfirm, onBack }: Props = $props();

  let text = $state("");
  let busy = $state(false);
  let error = $state<string | null>(null);
  const accept = $derived(kind === "accept");
  const canConfirm = $derived(!busy && (accept || text.trim().length > 0));

  async function confirm() {
    busy = true;
    error = null;
    try {
      await onConfirm(text.trim());
    } catch (e) {
      error = errorMessage(e);
    } finally {
      busy = false;
    }
  }
</script>

<Sheet title={accept ? "Lo hago yo" : `Rechazar la solicitud de ${fromName}`} onClose={onBack}>
  <p class="sheet-sub">
    {accept ? "Para lo que el agente no puede hacer (GCP, GitHub…)." : "El motivo es obligatorio: le llegará con el rechazo."}
  </p>
  <div class="bubble" style="max-width: 100%; margin-bottom: 12px"><p class="card-msg">{message}</p></div>
  <textarea
    bind:value={text}
    aria-label={accept ? "Nota" : "Motivo"}
    placeholder={accept ? 'Nota opcional: "lo hago en 10 min"' : `Explícale a ${fromName} por qué`}
  ></textarea>
  <div class="actions">
    <button class={accept ? "primary" : "no"} disabled={!canConfirm} onclick={confirm}>
      {accept ? "Confirmar: lo hago yo" : "Confirmar rechazo"}
    </button>
    <button onclick={onBack}>Volver</button>
  </div>
  {#if error}<div class="error">{error}</div>{/if}
</Sheet>
