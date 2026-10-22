<script lang="ts">
  // «Tu semana» bajo demanda (barra lateral): pide el resumen al abrirse.
  import { onMount } from "svelte";
  import { errorMessage } from "../../lib/api";
  import { useApp } from "../../lib/context";
  import Page from "../Page.svelte";
  import WeekCard from "./WeekCard.svelte";

  const app = useApp();
  let error = $state<string | null>(null);

  onMount(() => {
    app.loadWeek().catch((e) => (error = errorMessage(e)));
  });
</script>

<Page title="Tu semana">
  <WeekCard week={app.week} {error} nameOf={(id) => app.team.nameOf(id)} />
</Page>
