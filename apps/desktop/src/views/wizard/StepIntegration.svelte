<script lang="ts">
  // Instala el binario `devi` en una ruta estable y el plugin de Claude Code (devi@devi-local).
  import DeviCommand from "../../components/DeviCommand.svelte";
  import { errorMessage } from "../../lib/api";
  import { deviFailure, lastJsonLine } from "../../lib/format";
  import { type DeviOutput, native } from "../../lib/native";

  type Props = { onNext: () => void; onBack: () => void };
  let { onNext, onBack }: Props = $props();

  type InstallResult = { ok: boolean; binPath: string; marketplaceDir: string; steps: unknown[] };
  let result = $state<InstallResult | null>(null);
  let done = $state(false);
  let useAlias = $state(true);
  let alias = $state<{ ok: boolean; text: string } | null>(null);

  async function onDone(out: DeviOutput) {
    result = lastJsonLine<InstallResult>(out.stdout);
    // Solo cuenta como instalada con la línea JSON final y ok: true (sin ella no se sabe qué pasó).
    done = out.code === 0 && result?.ok === true;
    alias = null;
    if (done && useAlias) await installAlias();
  }

  // Necesita el binario estable que acaba de instalar install-integration. Si falla, se puede seguir.
  async function installAlias() {
    try {
      const out = await native.runDevi(["shell-alias", "install"]);
      alias =
        out.code === 0
          ? { ok: true, text: "Listo: en las terminales nuevas, `claude` abrirá Claude Code con Devi." }
          : { ok: false, text: deviFailure(out, "No se pudo instalar la función claude") };
    } catch (e) {
      alias = { ok: false, text: errorMessage(e) };
    }
  }
</script>

<section class="card glass">
  <div class="card-kicker">Paso 4 de 5 · Claude Code</div>
  <div class="card-title">Conectar Devi con Claude Code</div>
  <p class="muted">
    Copia el binario <span class="mono">devi</span> a una ruta estable e instala el plugin de Claude Code (herramientas,
    canal y hooks). Necesitas Claude Code instalado. Se puede repetir sin problema.
  </p>
  <label class="check">
    <input type="checkbox" bind:checked={useAlias} />
    Usar Devi automáticamente al escribir <span class="mono">claude</span> en la terminal
  </label>
  <p class="muted small">
    Se aplica a las terminales nuevas. Las sesiones abiertas desde un IDE o desde <span class="mono">cmd.exe</span> no tienen el
    canal en tiempo real, pero siguen recibiendo las solicitudes cuando escribes. Lo puedes cambiar luego en Ajustes.
  </p>
  <DeviCommand args={["install-integration", "--json"]} label="Instalar integración" {onDone} />
  {#if result?.binPath}<p class="muted small">Binario: <span class="mono">{result.binPath}</span></p>{/if}
  {#if alias}<div class={alias.ok ? "ok-text" : "error"}>{alias.text}</div>{/if}
  <div class="actions">
    <button class="primary" disabled={!done} onclick={onNext}>Continuar</button>
    <button class="ghost" onclick={onNext}>Saltar por ahora</button>
    <button onclick={onBack}>Atrás</button>
  </div>
</section>
