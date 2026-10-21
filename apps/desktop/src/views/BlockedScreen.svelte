<script lang="ts">
  // Bloqueo genérico: 403 origin, missing_perm u otro 401/403, o un "failed" terminal del cliente.
  // Reintentar no es automático: lo decide la persona.
  import Devi from "../components/Devi.svelte";
  import { useApp } from "../lib/context";

  type Props = { message: string };
  let { message }: Props = $props();
  const app = useApp();
</script>

<div class="screen">
  <Devi offline size={72} />
  <h1>El servidor rechazó la conexión</h1>
  <p class="muted">{message}</p>
  <p class="mono small">{app.config?.serverUrl ?? ""}</p>
  <div class="actions center">
    <button class="primary" onclick={() => app.connect()}>Reintentar</button>
    <button onclick={() => app.restartWizard()}>Revisar la configuración</button>
  </div>
</div>
