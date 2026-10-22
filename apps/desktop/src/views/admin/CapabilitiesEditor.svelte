<script lang="ts">
  // Lista de textos libres que el agente lee para recomendar a quién pedir algo.
  type Props = { items: string[]; onChange: (items: string[]) => void };
  let { items, onChange }: Props = $props();

  let draft = $state("");

  function add() {
    const t = draft.trim();
    draft = "";
    if (!t || items.some((i) => i.toLowerCase() === t.toLowerCase())) return;
    onChange([...items, t]);
  }

  function remove(index: number) {
    onChange(items.filter((_, j) => j !== index));
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault(); // dentro del formulario del rol, Enter no debe guardar
      add();
    }
  }
</script>

<div class="field">
  <span class="label">Capacidades (las lee el agente para saber a quién pedir qué)</span>
  {#if items.length > 0}
    <ul class="caps">
      {#each items as item, i (i)}
        <li>
          <span>{item}</span>
          <button type="button" class="ghost round" aria-label={`Quitar ${item}`} onclick={() => remove(i)}>×</button>
        </li>
      {/each}
    </ul>
  {:else}
    <span class="muted small">Sin capacidades todavía.</span>
  {/if}
  <div class="cap-add">
    <input bind:value={draft} onkeydown={onKey} placeholder="Ej.: Aprobar PRs de backend" aria-label="Nueva capacidad" />
    <button type="button" onclick={add}>Añadir</button>
  </div>
</div>
