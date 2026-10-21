<script lang="ts">
  // Solo se monta con el permiso team.admin (lo decide Shell). El servidor lo vuelve a comprobar.
  import { useApp } from "../../lib/context";
  import AuditTab from "./AuditTab.svelte";
  import PeopleTab from "./PeopleTab.svelte";
  import RolesTab from "./RolesTab.svelte";
  import ServerTab from "./ServerTab.svelte";

  const app = useApp();
  let tab = $state<"personas" | "roles" | "servidor" | "auditoria">("personas");
  // Alertas de seguridad nuevas: el número desaparece al abrir la pestaña (AuditTab las da por vistas).
  const alerts = $derived(tab === "auditoria" ? 0 : app.auditAlerts.length);
</script>

<nav class="tabs sub">
  <button class:active={tab === "personas"} onclick={() => (tab = "personas")}>Personas</button>
  <button class:active={tab === "roles"} onclick={() => (tab = "roles")}>Roles</button>
  <button class:active={tab === "servidor"} onclick={() => (tab = "servidor")}>Servidor</button>
  <button class:active={tab === "auditoria"} onclick={() => (tab = "auditoria")}>
    Auditoría{#if alerts > 0}<span class="tab-count" aria-label="{alerts} alertas nuevas">{alerts}</span>{/if}
  </button>
</nav>

{#if tab === "personas"}
  <PeopleTab />
{:else if tab === "roles"}
  <RolesTab />
{:else if tab === "servidor"}
  <ServerTab />
{:else}
  <AuditTab />
{/if}
