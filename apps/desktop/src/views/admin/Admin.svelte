<script lang="ts">
  // Solo se monta con el permiso team.admin (lo decide Shell). El servidor lo vuelve a comprobar.
  import PeopleTab from "./PeopleTab.svelte";
  import RolesTab from "./RolesTab.svelte";
  import ServerTab from "./ServerTab.svelte";

  let tab = $state<"personas" | "roles" | "servidor">("personas");
</script>

<nav class="tabs sub">
  <button class:active={tab === "personas"} onclick={() => (tab = "personas")}>Personas</button>
  <button class:active={tab === "roles"} onclick={() => (tab = "roles")}>Roles</button>
  <button class:active={tab === "servidor"} onclick={() => (tab = "servidor")}>Servidor</button>
</nav>

{#if tab === "personas"}
  <PeopleTab />
{:else if tab === "roles"}
  <RolesTab />
{:else}
  <ServerTab />
{/if}
