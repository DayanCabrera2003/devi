<script lang="ts">
  // «+ Sesión nueva»: crea un código de un solo uso y lo copia como frase para pegar en una sesión nueva.
  import { type Claim, type ClaimTarget, claimPhrase } from "@devi/protocol";
  import { errorMessage } from "../lib/api";
  import Sheet from "./Sheet.svelte";

  type Props = {
    target: ClaimTarget;
    create: (t: ClaimTarget) => Promise<Claim>;
    cancel: (code: string) => Promise<void>;
    copy: (text: string) => Promise<boolean>;
    onBack: () => void;
    inline?: boolean;
  };
  let { target, create, cancel, copy, onBack, inline = false }: Props = $props();

  let claim = $state<Claim | null>(null);
  let copied = $state<boolean | null>(null);
  let busy = $state(false);
  let error = $state<string | null>(null);
  let now = $state(Date.now());
  const phrase = $derived(claim ? claimPhrase(claim.code) : "");
  const left = $derived(claim ? Math.max(0, Math.ceil((claim.expiresAt - now) / 60_000)) : 0);
  // Caducado ya no se canjea: enseñar la frase invitaría a pegar algo que el hook rechazará.
  const expired = $derived(claim !== null && claim.expiresAt <= now);

  $effect(() => {
    if (!claim) return;
    const h = setInterval(() => (now = Date.now()), 15_000);
    return () => clearInterval(h);
  });

  async function start() {
    busy = true;
    error = null;
    try {
      claim = await create(target);
      now = Date.now();
      copied = await copy(claimPhrase(claim.code));
    } catch (e) {
      error = errorMessage(e);
    } finally {
      busy = false;
    }
  }

  async function stop() {
    if (!claim) return;
    busy = true;
    error = null;
    try {
      await cancel(claim.code);
      onBack();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      busy = false;
    }
  }
</script>

<Sheet title="Enviar a una sesión nueva" onClose={onBack} {inline}>
  {#if !claim}
    <p class="sheet-sub">
      Devi te dará una frase para pegar como primer mensaje en una sesión nueva de Claude Code, en la carpeta del
      proyecto. Llegará como pregunta abierta, no como orden.
    </p>
    <div class="actions">
      <button onclick={onBack}>Volver</button>
      <button class="primary" disabled={busy} onclick={start}>Crear código</button>
    </div>
  {:else if expired}
    <p class="sheet-sub">El código caducó.</p>
    <div class="actions">
      <button onclick={onBack}>Volver</button>
      <button class="primary" onclick={() => ((claim = null), (copied = null))}>Crear otro</button>
    </div>
  {:else}
    <p class="sheet-sub">
      {copied ? "Copiado." : "No se pudo copiar: cópialo a mano."} Pégalo como primer mensaje en una sesión nueva, en la
      carpeta del proyecto. Vale una sola vez{left > 0 ? ` y caduca en ${left} min` : ""}.
    </p>
    <pre class="preview">{phrase}</pre>
    <div class="actions">
      <button onclick={async () => (copied = await copy(phrase))}>Copiar de nuevo</button>
      <button class="no" disabled={busy} onclick={stop}>Cancelar código</button>
      <button onclick={onBack}>Listo</button>
    </div>
  {/if}
  {#if error}<div class="error">{error}</div>{/if}
</Sheet>
