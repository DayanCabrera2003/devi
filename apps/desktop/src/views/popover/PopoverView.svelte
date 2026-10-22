<script lang="ts">
  // Panel de avisos: lo que me espera, con las mismas acciones que la app, en 360 × 520.
  import Devi from "../../components/Devi.svelte";
  import Icon from "../../components/Icon.svelte";
  import { errorMessage } from "../../lib/api";
  import { useApp } from "../../lib/context";
  import { type PopoverHost, popoverTitle } from "../../lib/popover";
  import PopoverCard from "./PopoverCard.svelte";

  type Props = { host: PopoverHost };
  let { host }: Props = $props();
  const app = useApp();

  const pending = $derived(app.inbox.pending);
  // Conversación de la última tarjeta pulsada: "Abrir Devi" la abre en la ventana principal.
  let selected = $state<string | null>(null);
  let selectedKey = $state<string | null>(null);
  let pauseError = $state<string | null>(null);

  async function togglePause(box: HTMLInputElement) {
    pauseError = null;
    try {
      await app.togglePause(box.checked);
    } catch (e) {
      pauseError = errorMessage(e);
    }
    box.checked = app.paused;
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") host.close();
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="popover glass">
  <header class="pop-head">
    <Devi size={34} offline={!app.conn.online} mood={app.mood} pokeKey={app.pokeKey} />
    <div class="pop-heading">
      <strong>{popoverTitle(pending)}</strong>
      <span class="pop-status">{app.conn.label}</span>
    </div>
    <button class="icon round" aria-label="Ajustes" title="Ajustes" onclick={() => host.openSettings()}><Icon name="gear" /></button>
    <button class="icon round" aria-label="Cerrar el panel" title="Cerrar" onclick={() => host.close()}><Icon name="close" /></button>
  </header>

  <div class="pop-list">
    {#if pending === 0}
      <div class="pop-empty">
        <Devi size={56} offline={!app.conn.online} mood={app.mood} />
        <p class="pop-empty-title">Nada pendiente</p>
        <p class="muted small">Te aviso aquí en cuanto alguien te pida algo.</p>
      </div>
    {:else}
      {#each app.inbox.cards as c (c.key)}
        <PopoverCard
          card={c}
          selected={selectedKey === c.key}
          onSelect={(id) => {
            selected = id;
            selectedKey = c.key;
          }}
        />
      {/each}
    {/if}
  </div>

  <footer class="pop-foot">
    <button class="primary" onclick={() => host.openMain(selected)}>Abrir Devi</button>
    <label class="check">
      <input class="switch" type="checkbox" checked={app.paused} onchange={(e) => togglePause(e.currentTarget)} />
      Pausar avisos
    </label>
  </footer>
  {#if pauseError}<div class="error pop-error">{pauseError}</div>{/if}
</div>
