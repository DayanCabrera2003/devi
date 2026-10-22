<script lang="ts">
  // Lo hago yo (nota opcional) o Rechazar (motivo obligatorio), en una hoja sobre el hilo. Al aceptar con nota,
  // se puede guardar en la base del equipo (pregunta y nota) para que otros la encuentren.
  import { errorMessage } from "../lib/api";
  import Sheet from "./Sheet.svelte";

  type Props = {
    kind: "accept" | "reject";
    fromName: string;
    message: string;
    onConfirm: (text: string, shareWithTeam: boolean) => Promise<void>;
    onBack: () => void;
    inline?: boolean;
  };
  let { kind, fromName, message, onConfirm, onBack, inline = false }: Props = $props();

  let text = $state("");
  let share = $state(false);
  let busy = $state(false);
  let error = $state<string | null>(null);
  const accept = $derived(kind === "accept");
  const canConfirm = $derived(!busy && (accept || text.trim().length > 0));

  async function confirm() {
    busy = true;
    error = null;
    try {
      await onConfirm(text.trim(), accept && share && text.trim().length > 0);
    } catch (e) {
      error = errorMessage(e);
    } finally {
      busy = false;
    }
  }
</script>

<Sheet title={accept ? "Lo hago yo" : `Rechazar la solicitud de ${fromName}`} onClose={onBack} {inline}>
  <p class="sheet-sub">
    {accept ? "Para lo que el agente no puede hacer (GCP, GitHub…)." : "El motivo es obligatorio: le llegará con el rechazo."}
  </p>
  <div class="bubble" style="max-width: 100%; margin-bottom: 12px"><p class="card-msg">{message}</p></div>
  <textarea
    bind:value={text}
    aria-label={accept ? "Nota" : "Motivo"}
    placeholder={accept ? 'Nota opcional: "lo hago en 10 min"' : `Explícale a ${fromName} por qué`}
  ></textarea>
  {#if accept}
    <label class="check">
      <input type="checkbox" bind:checked={share} disabled={!text.trim()} />
      <span>Guardar en la base del equipo <span class="muted small">(la pregunta y tu nota, sin archivos)</span></span>
    </label>
  {/if}
  <div class="actions">
    <button class={accept ? "primary" : "no"} disabled={!canConfirm} onclick={confirm}>
      {accept ? "Confirmar: lo hago yo" : "Confirmar rechazo"}
    </button>
    <button onclick={onBack}>Volver</button>
  </div>
  {#if error}<div class="error">{error}</div>{/if}
</Sheet>

<style>
  .check { display: flex; align-items: flex-start; gap: 8px; margin-top: 10px; font-size: 13px; cursor: pointer; }
  .check input { margin-top: 2px; flex: none; }
</style>
