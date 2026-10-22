<script lang="ts">
  // Raíz del modo demo: la misma interfaz que Shell, con la DeviApp de ejemplo.
  import { onMount, tick } from "svelte";
  import type { DeviApp } from "../lib/app.svelte";
  import { provideApp } from "../lib/context";
  import { applyTheme } from "../lib/theme";
  import ShellView from "../views/ShellView.svelte";
  import MascotWindow from "../views/MascotWindow.svelte";
  import PopoverView from "../views/popover/PopoverView.svelte";
  import Wizard from "../views/wizard/Wizard.svelte";

  type Props = { app: DeviApp; screen: string };
  let { app, screen }: Props = $props();
  // svelte-ignore state_referenced_locally
  provideApp(app);

  $effect(() => applyTheme(app.prefs.theme));

  // svelte-ignore state_referenced_locally
  const step = Number(/^wizard-?(\d)?$/.exec(screen)?.[1] ?? 1);
  // Panel de avisos: sin ventanas reales, los botones solo lo dicen en la consola.
  const popoverHost = {
    openMain: (id: string | null) => console.info("[demo] abrir Devi", id),
    openSettings: () => console.info("[demo] abrir Ajustes"),
    close: () => console.info("[demo] cerrar el panel"),
  };
  const ADMIN_TAB: Record<string, string> = { "admin-roles": "Roles", "admin-servidor": "Servidor", "admin-auditoria": "Auditoría" };

  // Las pestañas de Admin y el rol abierto se eligen como lo haría una persona.
  onMount(async () => {
    await tick();
    const label = ADMIN_TAB[screen];
    if (label) {
      const b = [...document.querySelectorAll<HTMLButtonElement>(".page-head .segmented button")].find((x) => x.textContent?.trim().startsWith(label));
      b?.click();
      await tick();
      if (screen === "admin-roles") document.querySelector<HTMLButtonElement>(".role-item:nth-child(2)")?.click();
    }
  });
</script>

{#if screen === "mascot"}
  <MascotWindow initial={{ online: true, pending: 3, label: "conectado", pokeKey: 0, mood: "attentive" }} />
{:else if screen === "avisos"}
  <!-- Mismo tamaño que la ventana `avisos`, sobre el fondo ambiente para ver el cristal. -->
  <div class="ambient" aria-hidden="true"><span></span></div>
  <div class="demo-popover"><PopoverView host={popoverHost} /></div>
{:else if screen.startsWith("wizard")}
  <div class="ambient" aria-hidden="true"><span></span></div>
  <Wizard initialStep={step} />
{:else}
  <ShellView />
{/if}

<style>
  .demo-popover { width: 360px; height: 520px; margin: 32px auto; }
</style>
