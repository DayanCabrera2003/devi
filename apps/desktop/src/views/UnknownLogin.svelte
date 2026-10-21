<script lang="ts">
  // 403 unknown_login: Tailscale te identifica, pero el admin aún no te ha añadido.
  import Devi from "../components/Devi.svelte";
  import { useApp } from "../lib/context";

  type Props = { login: string };
  let { login }: Props = $props();
  const app = useApp();
</script>

<div class="screen">
  <Devi offline size={72} />
  <h1>Aún no estás en el equipo de Devi</h1>
  <p class="muted">Tailscale te identifica como</p>
  <p class="code">{login || "(login desconocido)"}</p>
  <p class="muted">
    Pide al admin de Devi que te añada con ese login (Admin → Personas → Invitar por login). Cuando lo haga, pulsa
    Reintentar.
  </p>
  <div class="actions center">
    <button class="primary" onclick={() => app.connect()}>Reintentar</button>
    <button onclick={() => app.restartWizard()}>Cambiar de servidor</button>
  </div>
</div>
