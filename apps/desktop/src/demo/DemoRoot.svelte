<script lang="ts">
  // Raíz del modo demo: la misma interfaz que Shell, con la DeviApp de ejemplo.
  import { onMount, tick } from "svelte";
  import type { DeviApp } from "../lib/app.svelte";
  import { provideApp } from "../lib/context";
  import { applyTheme } from "../lib/theme";
  import ShellView from "../views/ShellView.svelte";
  import MascotWindow from "../views/MascotWindow.svelte";
  import Wizard from "../views/wizard/Wizard.svelte";

  type Props = { app: DeviApp; screen: string };
  let { app, screen }: Props = $props();
  // svelte-ignore state_referenced_locally
  provideApp(app);

  $effect(() => applyTheme(app.prefs.theme));

  // svelte-ignore state_referenced_locally
  const step = Number(/^wizard-?(\d)?$/.exec(screen)?.[1] ?? 1);
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
  <MascotWindow initial={{ online: true, pending: 3, label: "conectado", pokeKey: 0 }} />
{:else if screen.startsWith("wizard")}
  <div class="ambient" aria-hidden="true"><span></span></div>
  <Wizard initialStep={step} />
{:else}
  <ShellView />
{/if}
