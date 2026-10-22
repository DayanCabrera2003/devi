<script lang="ts">
  // Avatar redondo con iniciales sobre degradado gris; punto verde si está en línea.
  import { initials } from "../lib/people";

  type Props = { name: string; size?: number; online?: boolean };
  let { name, size = 40, online = false }: Props = $props();
</script>

<span class="avatar" style:--size="{size}px" aria-hidden="true">
  {initials(name)}
  {#if online}<span class="presence"></span>{/if}
</span>
