<script lang="ts">
  // Iconos de trazo fino al estilo de SF Symbols. Siempre decorativos: el nombre lo da el botón.
  type Name = "gear" | "people" | "power" | "search" | "back" | "plus" | "up" | "close" | "doc" | "tray";
  type Props = { name: Name };
  let { name }: Props = $props();
</script>

<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  {#if name === "gear"}
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  {:else if name === "people"}
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5" />
    <path d="M15.5 5.2a3 3 0 0 1 0 5.6M17.5 14.4c1.6.7 2.6 2.2 3 4.6" />
  {:else if name === "power"}
    <path d="M12 3v8" />
    <path d="M6.3 6.8a8 8 0 1 0 11.4 0" />
  {:else if name === "search"}
    <circle cx="10.5" cy="10.5" r="6" />
    <path d="M15 15l5 5" />
  {:else if name === "back"}
    <path d="M15 5l-7 7 7 7" stroke-width="2.2" />
  {:else if name === "plus"}
    <path d="M12 5v14M5 12h14" stroke-width="2" />
  {:else if name === "up"}
    <path d="M12 19V6M6 11.5L12 5.5l6 6" stroke-width="2.2" />
  {:else if name === "close"}
    <path d="M7 7l10 10M17 7L7 17" stroke-width="1.9" />
  {:else if name === "doc"}
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5M9 13h6M9 17h4" />
  {:else if name === "tray"}
    <path d="M4 13l2.5-7h11L20 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
    <path d="M4 13h4.5l1 2h5l1-2H20" />
  {/if}
</svg>
