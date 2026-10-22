<script lang="ts">
  // Devi: parpadea, rebota cuando llega algo nuevo (cada cambio de pokeKey) y cambia de humor (mood):
  // dormida (ojos cerrados y «z z»), atenta (mira hacia abajo), inquieta (tiembla y suda), contenta (ojos ^ ^)
  // y gris sin conexión. Sin mood, el humor sale de offline y looking, como antes.
  import type { Mood } from "../lib/mood";

  type Props = { size?: number; offline?: boolean; looking?: boolean; pokeKey?: number; mood?: Mood };
  let { size = 64, offline = false, looking = false, pokeKey = 0, mood }: Props = $props();

  const current = $derived<Mood>(offline ? "offline" : (mood ?? (looking ? "attentive" : "calm")));
  const LABELS: Record<Mood, string> = {
    calm: "Devi",
    attentive: "Devi (atenta)",
    sleeping: "Devi (dormida)",
    uneasy: "Devi (inquieta)",
    happy: "Devi (contenta)",
    offline: "Devi (sin conexión)",
  };
</script>

{#key pokeKey}
  <svg
    class="devi"
    class:offline={current === "offline"}
    class:look={current === "attentive"}
    class:uneasy={current === "uneasy"}
    class:sleeping={current === "sleeping"}
    class:bounce={pokeKey > 0}
    data-mood={current}
    width={size}
    height={size}
    viewBox="0 0 100 100"
    role="img"
    aria-label={LABELS[current]}
  >
    <g class="figure">
      <circle class="body" cx="50" cy="50" r="44" />
      {#if current === "sleeping"}
        <g class="eyes closed">
          <path d="M30 47 q6 6 12 0" />
          <path d="M58 47 q6 6 12 0" />
        </g>
      {:else if current === "happy"}
        <g class="eyes happy">
          <path d="M30 50 l6 -8 l6 8" />
          <path d="M58 50 l6 -8 l6 8" />
        </g>
      {:else}
        <g class="eyes">
          <ellipse cx="36" cy="46" rx="6" ry="9" />
          <ellipse cx="64" cy="46" rx="6" ry="9" />
        </g>
      {/if}
      {#if current === "uneasy"}
        <path class="sweat" d="M80 20 q-6 9 0 12 q6 -3 0 -12 z" />
      {/if}
    </g>
    {#if current === "sleeping"}
      <text class="zz" aria-hidden="true"><tspan x="82" y="20">z</tspan><tspan x="92" y="8">z</tspan></text>
    {/if}
  </svg>
{/key}

<style>
  .devi { flex: none; overflow: visible; filter: drop-shadow(0 6px 14px rgb(0 0 0 / 0.22)); }
  .body { fill: var(--devi-body); stroke: var(--devi-stroke); stroke-width: 1.5; transition: fill 0.3s; }
  .eyes {
    fill: var(--devi-eye);
    transform-origin: 50px 46px;
    transition: transform 0.35s ease;
    animation: blink 4.5s infinite;
  }
  /* ojos de trazo (dormida y contenta): sin relleno y sin parpadeo */
  .eyes.closed,
  .eyes.happy {
    fill: none;
    stroke: var(--devi-eye);
    stroke-width: 4;
    stroke-linecap: round;
    stroke-linejoin: round;
    animation: none;
  }
  .look .eyes { transform: translateY(7px); animation: none; }
  .bounce { animation: bounce 0.7s cubic-bezier(0.3, 1.6, 0.5, 1); }
  .offline .body { fill: var(--devi-off); }

  /* inquieta: tiembla de vez en cuando y le cae una gota de sudor */
  .uneasy .figure { animation: shake 2.4s ease-in-out infinite; }
  .sweat { fill: var(--accent); stroke: var(--devi-stroke); stroke-width: 1; }

  /* dormida: respira despacio y las «z» suben */
  .sleeping .figure { transform-origin: 50px 94px; animation: breathe 4s ease-in-out infinite; }
  .zz { fill: var(--label2); font: 700 15px var(--sans); animation: float 3s ease-in-out infinite; }

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
  @keyframes shake {
    0%, 70%, 100% { transform: translateX(0); }
    74%, 82%, 90% { transform: translateX(-2px); }
    78%, 86%, 94% { transform: translateX(2px); }
  }
  @keyframes breathe {
    0%, 100% { transform: scale(1, 1); }
    50% { transform: scale(1.02, 0.98); }
  }
  @keyframes float {
    0%, 100% { transform: translateY(0); opacity: 1; }
    50% { transform: translateY(-3px); opacity: 0.6; }
  }

  /* Movimiento reducido: Devi cambia de cara pero no se mueve. */
  @media (prefers-reduced-motion: reduce) {
    .eyes, .bounce, .figure, .zz { animation: none; }
    .eyes, .body { transition: none; }
  }
</style>
