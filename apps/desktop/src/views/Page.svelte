<script lang="ts">
  // Página del panel derecho (Ajustes, Admin): barra de cristal con volver, título y herramientas.
  import type { Snippet } from "svelte";
  import Icon from "../components/Icon.svelte";
  import { useApp } from "../lib/context";

  type Props = { title: string; tools?: Snippet; children: Snippet };
  let { title, tools, children }: Props = $props();
  const app = useApp();
</script>

<div class="page-head glass flat">
  <button class="icon back" aria-label="Volver" onclick={() => app.goto("bandeja")}><Icon name="back" /></button>
  <h1>{title}</h1>
  {@render tools?.()}
</div>
<div class="page-scroll">
  <div class="page-body">
    {@render children()}
  </div>
</div>
