<script lang="ts">
  // Tarjeta «Tu semana»: Devi y los números de los últimos 7 días. Solo pinta; quien la usa pide los datos.
  import type { Week } from "@devi/protocol";
  import Devi from "../../components/Devi.svelte";
  import { durationText } from "../../lib/week";

  type Props = {
    week: Week | null;
    error?: string | null;
    nameOf: (id: string) => string;
    onDismiss?: () => void;
  };
  let { week, error = null, nameOf, onDismiss }: Props = $props();

  const quiet = $derived(!!week && week.sent === 0 && week.received === 0 && week.answered === 0);
  const helped = $derived(week ? week.topHelped.map((p) => `${nameOf(p.memberId)} (${p.count})`) : []);

  function list(items: string[]): string {
    return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} y ${items.at(-1)}`;
  }
</script>

<section class="week card" aria-label="Tu semana">
  <div class="week-head">
    <Devi size={44} mood={week && week.answered > 0 ? "happy" : "calm"} />
    <div class="week-titles">
      <div class="week-title">Tu semana</div>
      <div class="muted small">Últimos 7 días</div>
    </div>
    {#if onDismiss}
      <button class="ghost week-dismiss" onclick={onDismiss}>Descartar</button>
    {/if}
  </div>

  {#if error}
    <p class="error small">{error}</p>
  {:else if !week}
    <p class="muted small">Cargando…</p>
  {:else if quiet}
    <p class="small">Semana tranquila: no enviaste ni recibiste nada. Aquí estaré cuando haga falta.</p>
  {:else}
    <dl class="week-stats">
      <div><dd>{week.sent}</dd><dt>Enviadas</dt></div>
      <div><dd>{week.received}</dd><dt>Recibidas</dt></div>
      <div><dd>{week.answered}</dd><dt>Respondidas</dt></div>
    </dl>
    {#if week.avgResponseMs !== null}
      <p class="small">Tardaste de media {durationText(week.avgResponseMs)} en responder.</p>
    {/if}
    {#if helped.length > 0}
      <p class="small">Ayudaste sobre todo a {list(helped)}.</p>
    {/if}
  {/if}
</section>

<style>
  .week-head { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
  .week-titles { flex: 1; min-width: 0; }
  .week-title { font-size: 15px; font-weight: 650; letter-spacing: -0.01em; }
  .week-dismiss { flex: none; }
  .week-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 0 0 10px; }
  .week-stats div { display: flex; flex-direction: column-reverse; align-items: center; padding: 8px 4px; border-radius: 10px; background: var(--fill); }
  .week-stats dd { margin: 0; font-size: 20px; font-weight: 650; color: var(--label); font-variant-numeric: tabular-nums; }
  .week-stats dt { font-size: 11px; color: var(--label2); }
  p { margin: 4px 0 0; color: var(--label); }
</style>
