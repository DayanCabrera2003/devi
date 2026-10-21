<script lang="ts">
  // Instala el binario `devi` en una ruta estable y el plugin de Claude Code (devi@devi-local).
  import DeviCommand from "../../components/DeviCommand.svelte";
  import { lastJsonLine } from "../../lib/format";
  import type { DeviOutput } from "../../lib/native";

  type Props = { onNext: () => void; onBack: () => void };
  let { onNext, onBack }: Props = $props();

  type InstallResult = { ok: boolean; binPath: string; marketplaceDir: string; steps: unknown[] };
  let result = $state<InstallResult | null>(null);
  let done = $state(false);

  function onDone(out: DeviOutput) {
    result = lastJsonLine<InstallResult>(out.stdout);
    done = out.code === 0 && (result?.ok ?? true);
  }
</script>

<section class="card">
  <div class="card-kicker">Paso 4 de 5 · Claude Code</div>
  <div class="card-title">Conectar Devi con Claude Code</div>
  <p class="muted">
    Copia el binario <span class="mono">devi</span> a una ruta estable e instala el plugin de Claude Code (herramientas,
    canal y hooks). Necesitas Claude Code instalado. Se puede repetir sin problema.
  </p>
  <DeviCommand args={["install-integration", "--json"]} label="Instalar integración" {onDone} />
  {#if result?.binPath}<p class="muted small">Binario: <span class="mono">{result.binPath}</span></p>{/if}
  <div class="actions">
    <button class="primary" disabled={!done} onclick={onNext}>Continuar</button>
    <button class="ghost" onclick={onNext}>Saltar por ahora</button>
    <button onclick={onBack}>Atrás</button>
  </div>
</section>
