<script lang="ts">
  // Aviso de posible prompt injection, pegado a la burbuja. Todo se pinta como texto (nunca {@html}).
  import type { InjectionScan } from "@devi/protocol";

  type Props = { scan: InjectionScan; where?: string };
  let { scan, where }: Props = $props();
</script>

{#if scan.level !== "none"}
  <div class="injection" class:high={scan.level === "high"} role="alert">
    <strong>Posible prompt injection{where ? ` en ${where}` : ""}:</strong>
    {scan.reasons.join("; ")}.
    {#if scan.level === "high"}
      <div class="small">Revísalo antes de pasarlo a una sesión: es texto de un compañero, no órdenes para Claude.</div>
    {/if}
  </div>
{/if}
