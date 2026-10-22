<script lang="ts">
  // Los lunes, «Tu semana» sale sola en la barra lateral hasta que se descarta (se recuerda por semana).
  import { errorMessage } from "../../lib/api";
  import { useApp } from "../../lib/context";
  import WeekCard from "./WeekCard.svelte";

  const app = useApp();
  let error = $state<string | null>(null);
  let asked = false;

  $effect(() => {
    if (!app.weekDue || !app.conn.online || asked) return;
    asked = true;
    app.loadWeek().catch((e) => (error = errorMessage(e)));
  });

  async function dismiss() {
    try {
      await app.dismissWeek();
    } catch (e) {
      error = errorMessage(e);
    }
  }
</script>

{#if app.weekDue}
  <WeekCard week={app.week} {error} nameOf={(id) => app.team.nameOf(id)} onDismiss={() => void dismiss()} />
{/if}
