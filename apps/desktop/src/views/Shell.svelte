<script lang="ts">
  import { listen } from "@tauri-apps/api/event";
  import { onMount } from "svelte";
  import Devi from "../components/Devi.svelte";
  import { createApp } from "../lib/boot";
  import { provideApp } from "../lib/context";
  import { MASCOT_READY } from "../lib/mascot";
  import { native } from "../lib/native";
  import BlockedScreen from "./BlockedScreen.svelte";
  import Inbox from "./Inbox.svelte";
  import Settings from "./Settings.svelte";
  import UnknownLogin from "./UnknownLogin.svelte";
  import UpdateBanner from "./UpdateBanner.svelte";
  import UpdateRequired from "./UpdateRequired.svelte";
  import Admin from "./admin/Admin.svelte";
  import Wizard from "./wizard/Wizard.svelte";

  const app = createApp();
  provideApp(app);

  onMount(() => {
    const offs = [
      listen<boolean>("devi://paused", (e) => app.setPaused(e.payload)),
      listen<string>("devi://navigate", (e) => {
        if (e.payload === "ajustes") app.goto("ajustes");
      }),
      listen(MASCOT_READY, () => app.publishMascot()),
    ];
    const stopClock = app.clock.start();
    void app.boot();
    return () => {
      stopClock();
      app.disconnect();
      for (const off of offs) void off.then((f) => f());
    };
  });

  const c = $derived(app.conn.state);
  const hello = $derived(app.team.me ? `Hola, ${app.team.me.member.name}` : "Devi");
</script>

{#if app.phase === "loading"}
  <div class="empty">Cargando…</div>
{:else if app.phase === "wizard"}
  <Wizard />
{:else if c.status === "unknown_login"}
  <UnknownLogin login={c.login} />
{:else if c.status === "update_required"}
  <UpdateRequired minVersion={c.minVersion} />
{:else if c.status === "blocked"}
  <BlockedScreen message={c.message} />
{:else}
  <header class="top">
    <Devi offline={!app.conn.online} looking={app.inbox.pending > 0} pokeKey={app.pokeKey} />
    <div class="hello">
      <div class="hello-name">{hello}</div>
      <div class="hello-status">
        <span class="dot" class:on={app.conn.online}></span><span>{app.conn.label}</span>
      </div>
    </div>
    <!-- Sin icono de bandeja (GNOME sin AppIndicator) esta es la única forma de cerrar Devi. -->
    <button class="ghost" title="Cierra Devi y su servidor" onclick={() => void native.quitApp()}>Salir de Devi</button>
  </header>

  <UpdateBanner />
  {#if app.paused}
    <div class="banner">
      <span>Avisos en pausa.</span>
      <button class="ghost" onclick={() => app.togglePause(false)}>Reanudar</button>
    </div>
  {/if}

  <nav class="tabs">
    <button class:active={app.view === "bandeja"} onclick={() => app.goto("bandeja")}>
      Bandeja{#if app.inbox.pending > 0}<span class="count">{app.inbox.pending}</span>{/if}
    </button>
    <button class:active={app.view === "ajustes"} onclick={() => app.goto("ajustes")}>Ajustes</button>
    {#if app.team.isAdmin}
      <button class:active={app.view === "admin"} onclick={() => app.goto("admin")}>Admin</button>
    {/if}
  </nav>

  <main>
    {#if app.view === "ajustes"}
      <Settings />
    {:else if app.view === "admin" && app.team.isAdmin}
      <Admin />
    {:else}
      <Inbox />
    {/if}
  </main>
{/if}
