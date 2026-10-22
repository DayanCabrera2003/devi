<script lang="ts">
  import { PERMS, PERM_LABELS, type Perm, type Role, type TeamView } from "@devi/protocol";
  import { LAST_ADMIN_HINT, canDeleteRole, canRevokeAdminFromRole } from "../../lib/admins";
  import { type RoleBody, errorMessage } from "../../lib/api";
  import CapabilitiesEditor from "./CapabilitiesEditor.svelte";

  type Props = {
    role: Role | null;
    team: TeamView;
    onSave: (b: RoleBody) => Promise<void>;
    onDelete?: () => Promise<void>;
    onCancel: () => void;
  };
  let { role, team, onSave, onDelete, onCancel }: Props = $props();

  // Valores iniciales: RolesTab monta el editor de nuevo al elegir otro rol ({#key}).
  // svelte-ignore state_referenced_locally
  let name = $state(role?.name ?? "");
  // svelte-ignore state_referenced_locally
  let color = $state(role?.color ?? "#4a7bd8");
  // svelte-ignore state_referenced_locally
  let capabilities = $state<string[]>([...(role?.capabilities ?? [])]);
  // svelte-ignore state_referenced_locally
  let perms = $state<Perm[]>([...(role?.perms ?? [])]);
  let confirmDelete = $state(false);
  let busy = $state(false);
  let saved = $state(false);
  let error = $state<string | null>(null);
  // Con el equipo tal como está en el servidor: ¿es este el único rol que deja algún admin?
  const adminLocked = $derived(!!role && perms.includes("team.admin") && !canRevokeAdminFromRole(team, role.id));
  const deleteLocked = $derived(!!role && !canDeleteRole(team, role.id));

  function togglePerm(p: Perm, on: boolean) {
    perms = on ? [...perms, p] : perms.filter((x) => x !== p);
    saved = false;
  }

  async function run(fn: () => Promise<void>) {
    busy = true;
    error = null;
    try {
      await fn();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      busy = false;
    }
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await run(async () => {
      await onSave({ name: name.trim(), color, capabilities, perms });
      saved = true;
    });
  }
</script>

<form class="card" onsubmit={submit}>
  <div class="card-kicker">{role ? "Editar rol" : "Nuevo rol"}</div>
  <div class="field">
    <label for="r-name">Nombre</label>
    <div class="cap-add">
      <input id="r-name" bind:value={name} oninput={() => (saved = false)} placeholder="Backend" />
      <input type="color" bind:value={color} oninput={() => (saved = false)} aria-label="Color" />
    </div>
  </div>
  <CapabilitiesEditor
    items={capabilities}
    onChange={(c) => {
      capabilities = c;
      saved = false;
    }}
  />
  <fieldset class="field">
    <legend class="label">Permisos en Devi</legend>
    <div class="perm-list">
    {#each PERMS as p (p)}
      {@const locked = p === "team.admin" && adminLocked}
      <label class="check" title={p}>
        <input
          class="switch"
          type="checkbox"
          checked={perms.includes(p)}
          disabled={locked}
          onchange={(e) => togglePerm(p, e.currentTarget.checked)}
        />
        {PERM_LABELS[p]}
      </label>
    {/each}
    </div>
    {#if perms.includes("team.admin")}
      <span class="muted small">Administrar equipo da acceso a esta pestaña de Admin.</span>
    {/if}
  </fieldset>
  <div class="actions">
    <button class="primary" type="submit" disabled={busy || !name.trim()}>{role ? "Guardar" : "Crear rol"}</button>
    <button type="button" onclick={onCancel}>Cerrar</button>
    {#if onDelete}
      {#if confirmDelete}
        <button type="button" class="no" disabled={busy} onclick={() => onDelete && run(onDelete)}>Sí, borrar</button>
        <button type="button" class="ghost" onclick={() => (confirmDelete = false)}>No</button>
      {:else}
        <button
          type="button"
          class="ghost"
          disabled={deleteLocked}
          title={deleteLocked ? LAST_ADMIN_HINT : undefined}
          onclick={() => (confirmDelete = true)}>Borrar rol</button
        >
      {/if}
    {/if}
  </div>
  {#if adminLocked || deleteLocked}<p class="muted small">{LAST_ADMIN_HINT}</p>{/if}
  {#if confirmDelete}<p class="muted small">Las personas con este rol lo perderán, y con él sus permisos.</p>{/if}
  {#if saved}<div class="ok-text">Guardado.</div>{/if}
  {#if error}<div class="error">{error}</div>{/if}
</form>
