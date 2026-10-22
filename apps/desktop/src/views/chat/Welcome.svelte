<script lang="ts">
  // Panel derecho sin conversación abierta (solo con dos columnas).
  import Devi from "../../components/Devi.svelte";
  import { useApp } from "../../lib/context";

  const app = useApp();
  const waiting = $derived(Object.values(app.waiting).reduce((n, v) => n + v, 0));
</script>

<div class="welcome">
  <Devi size={88} offline={!app.conn.online} looking={waiting > 0} pokeKey={app.pokeKey} />
  {#if waiting > 0}
    <h2>{waiting === 1 ? "Una cosa te espera" : `${waiting} cosas te esperan`}</h2>
    <p>Elige una conversación de la lista. Las que tienen un punto azul esperan algo de ti.</p>
  {:else}
    <h2>Nada pendiente</h2>
    <p>Cuando un compañero te pida algo, aparecerá aquí. También puedes escribir a cualquiera desde la lista.</p>
    <div class="hint">Desde Claude Code: «pregúntale a un compañero si puede revisar mi PR».</div>
  {/if}
</div>
