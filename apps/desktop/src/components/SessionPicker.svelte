<script lang="ts">
  import type { Session } from "@devi/protocol";
  import { errorMessage } from "../lib/api";
  import { sortSessions } from "../lib/stores/sessions.svelte";

  type Props = {
    sessions: Session[];
    loading: boolean;
    error: string | null;
    title: string;
    hint: string;
    preferredId?: string;
    onPick: (s: Session) => Promise<void>;
    onBack: () => void;
  };
  let { sessions, loading, error, title, hint, preferredId, onPick, onBack }: Props = $props();

  const sorted = $derived(sortSessions(sessions, preferredId));
  let busy = $state(false);
  let pickError = $state<string | null>(null);

  async function pick(s: Session) {
    busy = true;
    pickError = null;
    try {
      await onPick(s);
    } catch (e) {
      pickError = errorMessage(e);
    } finally {
      busy = false;
    }
  }
</script>

<div class="card">
  <div class="card-kicker">Enviar a sesión</div>
  <div class="card-title">{title}</div>
  <div class="card-from">{hint}</div>
  <div class="sessions">
    {#if loading}
      <div class="muted">Buscando tus sesiones…</div>
    {:else if sorted.length === 0}
      <div class="muted">No tienes sesiones de Claude Code abiertas con Devi.</div>
    {:else}
      {#each sorted as s (s.id)}
        <button class="session" class:preferred={s.id === preferredId} disabled={busy} onclick={() => pick(s)}>
          <span class="dot" class:busy={s.status === "working"} class:on={s.status !== "working"}></span>
          <span class="mono">{s.name}</span>
          <span class="state">{s.status === "working" ? "trabajando" : "libre"}</span>
        </button>
      {/each}
    {/if}
  </div>
  <div class="actions"><button onclick={onBack}>Volver</button></div>
  {#if pickError ?? error}<div class="error">{pickError ?? error}</div>{/if}
</div>
