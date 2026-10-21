<script lang="ts">
  // Aceptar (nota opcional: lo hace la persona) o Rechazar (motivo obligatorio).
  import { errorMessage } from "../lib/api";

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

<div class="card">
  <div class="card-kicker">{accept ? "Aceptar" : "Rechazar"}</div>
  <div class="card-title">{accept ? "Lo harás tú" : `Rechazar la solicitud de ${fromName}`}</div>
  <div class="card-from">
    {accept ? "Para lo que el agente no puede hacer (GCP, GitHub…)." : "El motivo es obligatorio: le llegará con el rechazo."}
  </div>
  <p class="card-msg">{message}</p>
  <textarea
    bind:value={text}
    placeholder={accept ? 'Nota opcional: "lo hago en 10 min"' : `Explícale a ${fromName} por qué`}
  ></textarea>
  <div class="actions">
    <button class={accept ? "ok" : "no"} disabled={!canConfirm} onclick={confirm}>
      {accept ? "Confirmar: lo hago yo" : "Confirmar rechazo"}
    </button>
    <button onclick={onBack}>Volver</button>
  </div>
  {#if error}<div class="error">{error}</div>{/if}
</div>
