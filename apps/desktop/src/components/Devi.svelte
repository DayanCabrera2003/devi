<script lang="ts">
  // Devi: parpadea, mira hacia abajo si hay algo pendiente, rebota cuando llega algo nuevo
  // (cada cambio de pokeKey) y se pone gris sin conexión.
  type Props = { size?: number; offline?: boolean; looking?: boolean; pokeKey?: number };
  let { size = 64, offline = false, looking = false, pokeKey = 0 }: Props = $props();
</script>

{#key pokeKey}
  <svg
    class="devi"
    class:offline
    class:look={looking}
    class:bounce={pokeKey > 0}
    width={size}
    height={size}
    viewBox="0 0 100 100"
    role="img"
    aria-label="Devi"
  >
    <circle class="body" cx="50" cy="50" r="44" />
    <g class="eyes">
      <ellipse cx="36" cy="46" rx="6" ry="9" />
      <ellipse cx="64" cy="46" rx="6" ry="9" />
    </g>
  </svg>
{/key}

<style>
  .devi { flex: none; overflow: visible; }
  .body { fill: var(--white); transition: fill 0.3s; }
  .eyes {
    fill: var(--bg);
    transform-origin: 50px 46px;
    transition: transform 0.35s ease;
    animation: blink 4.5s infinite;
  }
  .look .eyes { transform: translateY(7px); animation: none; }
  .bounce { animation: bounce 0.7s cubic-bezier(0.3, 1.6, 0.5, 1); }
  .offline .body { fill: #5a5a62; }

  @keyframes blink {
    0%, 92%, 100% { transform: scaleY(1); }
    95% { transform: scaleY(0.1); }
  }
  @keyframes bounce {
    0% { transform: translateY(0); }
    30% { transform: translateY(-10px) scale(1.04, 0.96); }
    60% { transform: translateY(0) scale(0.97, 1.03); }
    100% { transform: translateY(0); }
  }
</style>
