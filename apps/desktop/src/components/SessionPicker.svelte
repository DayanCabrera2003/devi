<script lang="ts">
  // Popover de cristal con mis sesiones de Claude Code (hoja inferior en ventanas pequeñas).
  import type { Session } from "@devi/protocol";
  import { errorMessage } from "../lib/api";
  import { deliveryBadge, sortSessions } from "../lib/stores/sessions.svelte";
  import Sheet from "./Sheet.svelte";

  type Props = {
    sessions: Session[];
    loading: boolean;
    error: string | null;
    title: string;
    hint: string;
    preferredId?: string;
    onPick: (s: Session) => Promise<void>;
    onBack: () => void;
    // «+ Sesión nueva»: entregarlo con un código en una sesión que aún no existe.
    onNewSession?: () => void;
    inline?: boolean;
  };
  let { sessions, loading, error, title, hint, preferredId, onPick, onBack, onNewSession, inline = false }: Props = $props();

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

<Sheet {title} onClose={onBack} {inline}>
  <p class="sheet-sub">{hint}</p>
  <div class="sessions">
    {#if loading}
      <div class="muted">Buscando tus sesiones…</div>
    {:else if sorted.length === 0}
      <div class="muted">No tienes sesiones de Claude Code abiertas con Devi{onNewSession ? ": abre una nueva" : ""}.</div>
    {:else}
      {#each sorted as s (s.id)}
        {@const badge = deliveryBadge(s)}
        <button class="session" class:preferred={s.id === preferredId} disabled={busy} onclick={() => pick(s)}>
          <span class="dot" class:busy={s.status === "working"} class:on={s.status !== "working"}></span>
          <span class="mono">{s.name}</span>
          <span class="badge" class:live={s.channel} title={badge.title}>{badge.label}</span>
          <span class="state">{s.status === "working" ? "trabajando" : "libre"}</span>
        </button>
      {/each}
    {/if}
    {#if onNewSession}
      <button class="session new" disabled={busy} onclick={onNewSession}>+ Sesión nueva</button>
    {/if}
  </div>
  <div class="actions"><button onclick={onBack}>Volver</button></div>
  {#if pickError ?? error}<div class="error">{pickError ?? error}</div>{/if}
</Sheet>

<style>
  .new { color: var(--accent); }
</style>
