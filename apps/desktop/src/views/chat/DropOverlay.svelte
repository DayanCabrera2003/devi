<script lang="ts">
  // Mientras se arrastran archivos sobre la ventana. Los recoge Rust; aquí solo se avisa.
  import { FILE_LIMITS } from "@devi/protocol";
  import Icon from "../../components/Icon.svelte";

  const mb = FILE_LIMITS.maxBytes / 1_048_576;
</script>

<div class="drop" aria-live="polite">
  <div class="drop-card glass">
    <Icon name="tray" />
    <h2>Suelta para adjuntar</h2>
    <p>Archivos de texto · hasta {FILE_LIMITS.maxFiles} de {mb} MB</p>
  </div>
</div>
