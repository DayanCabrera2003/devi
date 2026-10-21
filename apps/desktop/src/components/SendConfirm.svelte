<script lang="ts">
  // Casilla obligatoria antes de "Enviar a sesión" cuando el contenido parece una inyección (nivel high).
  type Props = { checked: boolean };
  let { checked = $bindable() }: Props = $props();
</script>

<label class="send-confirm">
  <input type="checkbox" bind:checked />
  He revisado el contenido y quiero enviarlo a mi sesión
</label>
