<script lang="ts">
  import DeviCommand from "../../components/DeviCommand.svelte";
  import { errorMessage } from "../../lib/api";

  type Props = { serverMode: boolean; onFinish: () => Promise<void> };
  let { serverMode, onFinish }: Props = $props();

  let busy = $state(false);
  let error = $state<string | null>(null);

  async function finish() {
    busy = true;
    error = null;
    try {
      await onFinish();
    } catch (e) {
      error = errorMessage(e);
      busy = false;
    }
  }
</script>

<section class="card">
  <div class="card-kicker">Paso 5 de 5 · Listo</div>
  <div class="card-title">Devi ya está configurado</div>
  <p>
    Devi vive en la bandeja del sistema y en la ventanita de la mascota. Cuando un compañero te pida algo, o tu Claude
    quiera enviar algo, te aviso aquí.
  </p>
  {#if serverMode}
    <p class="muted small">Este equipo es el servidor: déjalo encendido y con Devi abierto para que el equipo pueda usarlo.</p>
  {/if}
  <p class="muted small">
    Para probarlo: abre Claude Code y pídele, por ejemplo, «pregúntale a un compañero si puede revisar mi PR».
  </p>
  <DeviCommand args={["doctor"]} label="Comprobar todo (devi doctor)" />
  <div class="actions"><button class="primary" disabled={busy} onclick={finish}>Abrir Devi</button></div>
  {#if error}<div class="error">{error}</div>{/if}
</section>
