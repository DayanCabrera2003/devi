<script lang="ts">
  // Registro de auditoría del servidor (solo admin). Todo se pinta como texto: nunca {@html}.
  import { onMount } from "svelte";
  import { errorMessage } from "../../lib/api";
  import { type AuditEntry, actionLabel, describeTarget, formatDetails } from "../../lib/audit";
  import { useApp } from "../../lib/context";

  const PAGE = 50;
  const app = useApp();

  let entries = $state<AuditEntry[]>([]);
  let nextBefore = $state<number | undefined>(undefined);
  let loading = $state(false);
  let loaded = $state(false);
  let error = $state<string | null>(null);
  let filter = $state("");

  const actions = $derived([...new Set(entries.map((e) => e.action))].sort((a, b) => actionLabel(a).localeCompare(actionLabel(b))));
  const shown = $derived(filter ? entries.filter((e) => e.action === filter) : entries);

  // Añade sin repetir (una alerta en vivo puede llegar también en la página).
  function merge(list: AuditEntry[], atTop: boolean) {
    const seen = new Set(entries.map((e) => e.id));
    const fresh = list.filter((e) => !seen.has(e.id));
    entries = atTop ? [...fresh, ...entries] : [...entries, ...fresh];
  }

  async function load(before?: number) {
    loading = true;
    error = null;
    try {
      const page = await app.call((api) => api.audit(before === undefined ? { limit: PAGE } : { limit: PAGE, before }));
      merge(page.entries, false);
      nextBefore = page.nextBefore;
      loaded = true;
    } catch (e) {
      error = errorMessage(e);
    } finally {
      loading = false;
    }
  }

  // Las alertas que llegan (o llegaron) por SSE se muestran arriba y se dan por vistas.
  $effect(() => {
    const alerts = app.auditAlerts;
    if (alerts.length === 0) return;
    merge(alerts, true);
    app.clearAuditAlerts();
  });

  onMount(() => void load());

  const when = (at: number) => new Date(at).toLocaleString("es-ES");
  const who = (e: AuditEntry) => (e.actorMemberId ? `${app.team.nameOf(e.actorMemberId)} (${e.actorLogin})` : e.actorLogin);
</script>

<div class="audit-head">
  <label class="label" for="audit-filter">Filtrar por acción</label>
  <select id="audit-filter" bind:value={filter}>
    <option value="">Todas</option>
    {#each actions as a (a)}
      <option value={a}>{actionLabel(a)}</option>
    {/each}
  </select>
</div>

{#if loaded && shown.length === 0}
  <p class="muted">Sin entradas de auditoría{filter ? " para esta acción" : ""}.</p>
{:else if shown.length > 0}
  <table class="people audit">
    <thead>
      <tr><th>Fecha</th><th>Quién</th><th>Acción</th><th>Destino</th><th>Detalles</th></tr>
    </thead>
    <tbody>
      {#each shown as e (e.id)}
        <tr>
          <td class="small">{when(e.at)}</td>
          <td>{who(e)}</td>
          <td>{actionLabel(e.action)}</td>
          <td>{describeTarget(e, (id) => app.team.nameOf(id))}</td>
          <td class="small">{formatDetails(e.details)}</td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}

{#if loading}<div class="muted small">Cargando…</div>{/if}
{#if error}<div class="error">{error}</div>{/if}
{#if nextBefore !== undefined && !loading}
  <div class="actions">
    <button onclick={() => load(nextBefore)}>Cargar más</button>
  </div>
{/if}
