<script lang="ts">
  // Lo que se ve en la ventana principal según la fase y la conexión. Con dos columnas
  // (lista + conversación) desde 760 px; por debajo, una sola que se empuja como en iOS.
  import { useApp } from "../lib/context";
  import { applyTheme } from "../lib/theme";
  import BlockedScreen from "./BlockedScreen.svelte";
  import Settings from "./Settings.svelte";
  import UnknownLogin from "./UnknownLogin.svelte";
  import UpdateRequired from "./UpdateRequired.svelte";
  import Admin from "./admin/Admin.svelte";
  import DropOverlay from "./chat/DropOverlay.svelte";
  import Sidebar from "./chat/Sidebar.svelte";
  import Thread from "./chat/Thread.svelte";
  import Welcome from "./chat/Welcome.svelte";
  import KnowledgeView from "./knowledge/KnowledgeView.svelte";
  import WeekView from "./week/WeekView.svelte";
  import Wizard from "./wizard/Wizard.svelte";

  const app = useApp();
  const c = $derived(app.conn.state);

  $effect(() => applyTheme(app.prefs.theme));

  const page = $derived(
    app.view === "ajustes" ? "ajustes" : app.view === "base" ? "base" : app.view === "semana" ? "semana" : app.view === "admin" && app.team.isAdmin ? "admin" : app.selected ? "thread" : "none",
  );
</script>

<div class="ambient" aria-hidden="true"><span></span></div>

{#if app.phase === "loading"}
  <div class="loading">Cargando…</div>
{:else if app.phase === "wizard"}
  <Wizard />
{:else if c.status === "unknown_login"}
  <UnknownLogin login={c.login} />
{:else if c.status === "update_required"}
  <UpdateRequired minVersion={c.minVersion} />
{:else if c.status === "blocked"}
  <BlockedScreen message={c.message} />
{:else}
  <div class="layout" data-pane={page === "none" ? "list" : "detail"}>
    <Sidebar />
    <main class="detail">
      {#key page === "thread" ? `t:${app.selected}` : page}
        <div class="pane">
          {#if page === "ajustes"}
            <Settings />
          {:else if page === "base"}
            <KnowledgeView />
          {:else if page === "admin"}
            <Admin />
          {:else if page === "semana"}
            <WeekView />
          {:else if page === "thread" && app.selected}
            <Thread memberId={app.selected} />
          {:else}
            <Welcome />
          {/if}
        </div>
      {/key}
    </main>
  </div>
  {#if app.drag.active && app.selected}<DropOverlay />{/if}
{/if}
