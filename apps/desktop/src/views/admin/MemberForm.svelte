<script lang="ts">
  import type { Member, Role } from "@devi/protocol";
  import { type MemberBody, errorMessage } from "../../lib/api";

  type Props = { member: Member | null; roles: Role[]; onSave: (b: MemberBody) => Promise<void>; onCancel: () => void };
  let { member, roles, onSave, onCancel }: Props = $props();

  // Valores iniciales: PeopleTab monta el formulario de nuevo para cada persona ({#key}).
  // svelte-ignore state_referenced_locally
  let login = $state(member?.login ?? "");
  // svelte-ignore state_referenced_locally
  let name = $state(member?.name ?? "");
  // svelte-ignore state_referenced_locally
  let description = $state(member?.description ?? "");
  // svelte-ignore state_referenced_locally
  let roleIds = $state<string[]>([...(member?.roleIds ?? [])]);
  let busy = $state(false);
  let error = $state<string | null>(null);
  const valid = $derived(login.trim() !== "" && name.trim() !== "");

  function toggleRole(id: string, on: boolean) {
    roleIds = on ? [...roleIds, id] : roleIds.filter((r) => r !== id);
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!valid) return;
    busy = true;
    error = null;
    try {
      await onSave({ login: login.trim(), name: name.trim(), description: description.trim(), roleIds });
    } catch (err) {
      error = errorMessage(err);
    } finally {
      busy = false;
    }
  }
</script>

<form class="card" onsubmit={submit}>
  <div class="card-kicker">{member ? "Editar persona" : "Invitar por login"}</div>
  {#if !member}
    <p class="muted small">Tendrá acceso en cuanto abra Devi con ese login de Tailscale.</p>
  {/if}
  <div class="field">
    <label for="m-login">Login de Tailscale</label>
    <input id="m-login" bind:value={login} placeholder="maria@empresa.com" autocomplete="off" />
  </div>
  <div class="field">
    <label for="m-name">Nombre</label>
    <input id="m-name" bind:value={name} placeholder="María" />
  </div>
  <div class="field">
    <label for="m-desc">Descripción (la lee el agente para saber a quién pedir qué)</label>
    <textarea id="m-desc" bind:value={description} placeholder="Backend; conoce la infraestructura de GCP"></textarea>
  </div>
  <fieldset class="field">
    <legend class="label">Roles</legend>
    {#each roles as r (r.id)}
      <label class="check">
        <input type="checkbox" checked={roleIds.includes(r.id)} onchange={(e) => toggleRole(r.id, e.currentTarget.checked)} />
        <span class="chip" style:color={r.color} style:border-color={r.color}>{r.name}</span>
      </label>
    {/each}
    {#if roles.length === 0}<span class="muted small">Aún no hay roles: créalos en la pestaña Roles.</span>{/if}
  </fieldset>
  <div class="actions">
    <button class="primary" type="submit" disabled={!valid || busy}>{member ? "Guardar" : "Invitar"}</button>
    <button type="button" onclick={onCancel}>Cancelar</button>
  </div>
  {#if error}<div class="error">{error}</div>{/if}
</form>
