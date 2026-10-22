<script lang="ts">
  // Aviso en mis sesiones de Claude Code al llegarme una solicitud (preferencia de cada persona, guardada en el
  // servidor porque es él quien avisa). Sirve para atenderla desde Claude Code, p. ej. desde el móvil con Remote Control.
  import { onMount } from "svelte";
  import { errorMessage } from "../../lib/api";
  import { useApp } from "../../lib/context";

  const app = useApp();
  let enabled = $state<boolean | null>(null);
  let busy = $state(false);
  let error = $state<string | null>(null);

  onMount(() => {
    app
      .call((a) => a.myPrefs())
      .then((p) => (enabled = p.sessionNotices))
      .catch((e) => (error = errorMessage(e)));
  });

  // Si falla, la casilla vuelve al estado real (el estado no cambió, así que Svelte no la repintaría).
  async function toggle(box: HTMLInputElement) {
    busy = true;
    error = null;
    try {
      enabled = (await app.call((a) => a.updateMyPrefs({ sessionNotices: box.checked }))).sessionNotices;
    } catch (e) {
      error = errorMessage(e);
    } finally {
      busy = false;
    }
    box.checked = enabled ?? false;
  }
</script>

<section class="group-box">
  <h2 class="group-title">Solicitudes en Claude Code</h2>
  <div class="inset">
    <div class="cell">
      <label class="check">
        <input class="switch" type="checkbox" checked={enabled ?? false} disabled={busy || enabled === null} onchange={(e) => toggle(e.currentTarget)} />
        <span>
          Avisar en mis sesiones de Claude Code
          <span class="sub">Al llegarte una solicitud, tu sesión más reciente te lo cuenta y puedes traerla o rechazarla desde allí</span>
        </span>
      </label>
    </div>
  </div>
  <p class="group-foot">
    Útil si atiendes Claude Code desde el móvil con Remote Control. Traerla o rechazarla siempre pide tu permiso en el aviso
    de Claude Code; si tu equipo no permite aprobar en el chat, se hace desde aquí.
  </p>
  {#if error}<div class="error">{error}</div>{/if}
</section>
