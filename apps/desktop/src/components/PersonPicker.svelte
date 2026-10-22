<script lang="ts">
  // Hoja con las personas del equipo a las que se puede pedir algo (pedírselo a otra persona).
  import { errorMessage } from "../lib/api";
  import type { Candidate } from "../lib/reassign";
  import Sheet from "./Sheet.svelte";

  type Props = { people: Candidate[]; title: string; hint: string; onPick: (id: string) => Promise<void>; onBack: () => void };
  let { people, title, hint, onPick, onBack }: Props = $props();

  let busy = $state(false);
  let error = $state<string | null>(null);

  async function pick(id: string) {
    busy = true;
    error = null;
    try {
      await onPick(id);
    } catch (e) {
      error = errorMessage(e);
    } finally {
      busy = false;
    }
  }
</script>

<Sheet {title} onClose={onBack}>
  <p class="sheet-sub">{hint}</p>
  <div class="sessions">
    {#each people as p (p.id)}
      <button class="session person" disabled={busy} onclick={() => pick(p.id)}>
        <span class="dot" class:on={p.connected}></span>
        <span>{p.name}</span>
        {#if p.roles.length > 0}<span class="badge">{p.roles.join(", ")}</span>{/if}
        <span class="state">{p.connected ? "conectada" : "desconectada"}</span>
        {#if p.capabilities.length > 0}<span class="muted small caps">{p.capabilities.join(" · ")}</span>{/if}
      </button>
    {:else}
      <div class="muted">No hay nadie más en el equipo a quien pedírselo.</div>
    {/each}
  </div>
  <div class="actions"><button onclick={onBack}>Volver</button></div>
  {#if error}<div class="error">{error}</div>{/if}
</Sheet>

<style>
  .person {
    flex-wrap: wrap;
  }
  .caps {
    flex-basis: 100%;
    text-align: left;
  }
</style>
