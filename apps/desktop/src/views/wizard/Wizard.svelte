<script lang="ts">
  import Devi from "../../components/Devi.svelte";
  import { useApp } from "../../lib/context";
  import { type ClientConfig, type TailscaleSelf, prefsOf } from "../../lib/native";
  import StepConnect from "./StepConnect.svelte";
  import StepDone from "./StepDone.svelte";
  import StepIntegration from "./StepIntegration.svelte";
  import StepServer from "./StepServer.svelte";
  import StepTailscale from "./StepTailscale.svelte";

  type Props = { initialStep?: number };
  let { initialStep = 1 }: Props = $props();
  const app = useApp();
  // svelte-ignore state_referenced_locally
  let step = $state(initialStep);
  let tsSelf = $state<TailscaleSelf | null>(null);
  // Parte de la configuración actual (si se vuelve a ejecutar el asistente).
  let draft = $state<ClientConfig>({
    serverUrl: app.config?.serverUrl ?? "",
    devUser: app.config?.devUser,
    receivedDir: app.config?.receivedDir,
    app: prefsOf(app.config),
  });

  function afterTailscale(self: TailscaleSelf | null, devUser?: string) {
    tsSelf = self;
    // Con Tailscale no hay devUser; sin él (modo desarrollo) se guarda y lo usa el cliente.
    draft = { ...draft, devUser: devUser || undefined };
    step = 2;
  }

  async function afterServer(p: { serverUrl: string; serverAdminLogin?: string }) {
    // Red de seguridad: sin modo servidor, el sidecar no puede quedarse en marcha sin dueño
    // (StepServer ya pide confirmación antes de llegar aquí).
    if (!p.serverAdminLogin && app.server?.running) await app.stopLocalServer().catch(() => {});
    draft = { ...draft, serverUrl: p.serverUrl, app: { ...prefsOf(draft), serverAdminLogin: p.serverAdminLogin } };
    step = 3;
  }

  const back = () => (step = Math.max(1, step - 1));
</script>

<div class="wizard">
  <header class="wizard-head">
    <Devi size={72} />
    <h1>Bienvenido a Devi</h1>
    <div class="progress" role="progressbar" aria-label="Paso {step} de 5" aria-valuemin={1} aria-valuemax={5} aria-valuenow={step}>
      {#each [1, 2, 3, 4, 5] as n (n)}<span class:done={n < step} class:now={n === step}></span>{/each}
    </div>
    <div class="muted small" style="margin-top: 6px">Paso {step} de 5</div>
    {#if app.canCancelWizard}
      <button class="ghost cancel" onclick={() => app.cancelWizard()}>Cancelar y volver a Devi</button>
    {/if}
  </header>

  {#if step === 1}
    <StepTailscale onNext={afterTailscale} />
  {:else if step === 2}
    <StepServer
      self={tsSelf}
      initialUrl={draft.serverUrl}
      initialServerMode={!!draft.app?.serverAdminLogin}
      onNext={afterServer}
      onBack={back}
    />
  {:else if step === 3}
    <StepConnect config={draft} onNext={() => (step = 4)} onBack={back} />
  {:else if step === 4}
    <StepIntegration onNext={() => (step = 5)} onBack={back} />
  {:else}
    <StepDone serverMode={!!draft.app?.serverAdminLogin} onFinish={() => app.finishWizard()} />
  {/if}
</div>
