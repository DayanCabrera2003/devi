<script lang="ts">
  // Contexto de una solicitud (lo intentado, el error, la urgencia y lo que el MCP sacó de git), plegado bajo
  // la burbuja. Lo escribe el compañero o su agente: todo se pinta como texto (nunca {@html}).
  import { type RequestContext, hasContext } from "@devi/protocol";

  type Props = { context: RequestContext | undefined };
  let { context }: Props = $props();

  const rows = $derived.by(() => {
    if (!hasContext(context)) return [];
    const c = context;
    const out: { label: string; value: string; pre?: boolean }[] = [];
    if (c.summary?.trim()) out.push({ label: "Resumen", value: c.summary.trim() });
    if (c.tried?.trim()) out.push({ label: "Qué se intentó", value: c.tried.trim() });
    if (c.error?.trim()) out.push({ label: "Error", value: c.error.trim(), pre: true });
    if (c.git?.branch?.trim()) out.push({ label: "Rama", value: c.git.branch.trim() });
    if (c.git?.commit?.trim()) out.push({ label: "Último commit", value: c.git.commit.trim() });
    if (c.git?.diffStat?.trim()) out.push({ label: "Cambios sin commit", value: c.git.diffStat.replace(/\s+$/, ""), pre: true });
    return out;
  });
</script>

{#if hasContext(context)}
  <details class="req-context">
    <summary>
      Contexto
      {#if context.urgency}<span class="urgency" class:high={context.urgency === "alta"}>· urgencia {context.urgency}</span>{/if}
    </summary>
    {#if rows.length > 0}
      <dl>
        {#each rows as row (row.label)}
          <dt>{row.label}</dt>
          <dd class:mono={row.pre}>{row.value}</dd>
        {/each}
      </dl>
    {/if}
  </details>
{/if}

<style>
  .req-context { max-width: min(78%, 560px); margin: 4px 12px 0; font-size: 12px; color: var(--label2); }
  .req-context summary { min-height: 28px; gap: 4px; }
  .urgency.high { color: var(--red-text); font-weight: 600; }
  dl { margin: 2px 0 4px; display: grid; grid-template-columns: max-content 1fr; gap: 3px 10px; }
  dt { font-weight: 600; }
  dd { margin: 0; overflow-wrap: anywhere; user-select: text; -webkit-user-select: text; }
  dd.mono { white-space: pre-wrap; font-size: 11.5px; }
</style>
