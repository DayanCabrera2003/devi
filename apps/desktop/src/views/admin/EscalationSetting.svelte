<script lang="ts">
  // Escalado con plazo: si una solicitud sigue sin respuesta este tiempo, Devi avisa a quien la envió (a su
  // sesión y a su app) para que se la pida a otra persona. Se guarda aparte del formulario de tiempos.
  import type { Settings } from "@devi/protocol";
  import { untrack } from "svelte";
  import { errorMessage } from "../../lib/api";
  import { useApp } from "../../lib/context";
  import { minutesToMs, msToMinutes } from "../../lib/format";

  type Props = { settings: Settings; onSaved: (s: Settings) => void };
  let { settings, onSaved }: Props = $props();
  const app = useApp();

  const DEFAULT_MIN = 30;
  const MIN = 5;
  const MAX = 24 * 60;

  // Valor inicial del campo: lo que había al montar (después lo edita la persona).
  let minutes = $state(untrack(() => msToMinutes(settings.escalateAfterMs ?? DEFAULT_MIN * 60_000)));
  let saving = $state(false);
  let msg = $state<string | null>(null);
  let error = $state<string | null>(null);
  const enabled = $derived(settings.escalateAfterMs !== null);

  async function save(patch: Partial<Settings>, ok: string): Promise<boolean> {
    saving = true;
    msg = null;
    error = null;
    try {
      onSaved(await app.call((a) => a.updateSettings(patch)));
      msg = ok;
      return true;
    } catch (e) {
      error = errorMessage(e);
      return false;
    } finally {
      saving = false;
    }
  }

  async function toggle(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const on = input.checked;
    const value = on ? minutesToMs(Number.isInteger(minutes) && minutes >= MIN && minutes <= MAX ? minutes : DEFAULT_MIN) : null;
    if (!(await save({ escalateAfterMs: value }, on ? "Activado." : "Desactivado: Devi no avisará de las solicitudes sin respuesta."))) {
      input.checked = !on;
    }
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    const v = minutes;
    if (typeof v !== "number" || !Number.isInteger(v) || v < MIN || v > MAX) {
      msg = null;
      error = "Escribe un número entero entre 5 minutos y 24 horas (1440 min).";
      return;
    }
    if (minutesToMs(v) >= settings.requestTimeoutMs) {
      msg = null;
      error = `Tiene que ser menor que el timeout de una solicitud (${msToMinutes(settings.requestTimeoutMs)} min).`;
      return;
    }
    await save({ escalateAfterMs: minutesToMs(v) }, "Plazo guardado.");
  }
</script>

<form class="card" onsubmit={submit} novalidate>
  <div class="card-kicker">Escalado</div>
  <label class="check">
    <input class="switch" style="order: 2; margin-left: auto" type="checkbox" checked={enabled} disabled={saving} onchange={toggle} />
    Avisar si una solicitud sigue sin respuesta
  </label>
  <p class="muted small">
    Si nadie la acepta, rechaza ni la envía a una sesión en este plazo, Devi avisa a quien la envió para que se la pida a otra persona. Devi no elige a nadie: lo decide esa persona (con la ayuda de su agente).
  </p>
  {#if enabled}
    <div class="field">
      <label for="s-escalate">Plazo para avisar (minutos)</label>
      <input id="s-escalate" type="number" min={MIN} max={MAX} step="1" bind:value={minutes} oninput={() => (msg = null)} />
      <span class="muted small">Entre 5 minutos y 24 horas, y menor que el timeout de una solicitud.</span>
    </div>
    <div class="actions"><button class="primary" type="submit" disabled={saving}>Guardar plazo</button></div>
  {/if}
  {#if msg}<div class="ok-text">{msg}</div>{/if}
  {#if error}<div class="error">{error}</div>{/if}
</form>
