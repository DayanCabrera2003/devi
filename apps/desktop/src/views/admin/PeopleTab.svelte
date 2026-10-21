<script lang="ts">
  import type { Member } from "@devi/protocol";
  import { LAST_ADMIN_HINT, canDisableMember } from "../../lib/admins";
  import { type MemberBody, errorMessage } from "../../lib/api";
  import { useApp } from "../../lib/context";
  import MemberForm from "./MemberForm.svelte";

  const app = useApp();
  let editing = $state<Member | null>(null);
  let inviting = $state(false);
  let error = $state<string | null>(null);
  let confirmDisable = $state<string | null>(null); // id de la persona a desactivar
  const members = $derived(app.team.team.members);

  // Si falla, el error lo muestra MemberForm y el formulario sigue abierto.
  async function save(body: MemberBody) {
    const current = editing;
    if (current) await app.admin((a) => a.updateMember(current.id, body));
    else await app.admin((a) => a.createMember(body));
    close();
  }

  async function setDisabled(m: Member, disabled: boolean) {
    error = null;
    confirmDisable = null;
    try {
      await app.admin((a) => a.updateMember(m.id, { disabled }));
    } catch (e) {
      error = errorMessage(e);
    }
  }

  function close() {
    editing = null;
    inviting = false;
  }
</script>

{#if editing || inviting}
  {#key editing?.id ?? "nuevo"}
    <MemberForm member={editing} team={app.team.team} onSave={save} onCancel={close} />
  {/key}
{:else}
  <div class="actions spread">
    <span class="muted small">{members.length} personas · {app.team.connectedCount} conectadas</span>
    <button class="primary" onclick={() => (inviting = true)}>Invitar por login</button>
  </div>
  <table class="people">
    <thead>
      <tr><th>Estado</th><th>Persona</th><th>Roles</th><th></th></tr>
    </thead>
    <tbody>
      {#each members as m (m.id)}
        <tr class:disabled-row={m.disabled}>
          <td>
            {#if m.disabled}
              <span class="muted small">desactivada</span>
            {:else}
              <span class="dot" class:on={m.connected}></span>
              <span class="muted small">{m.connected ? "conectada" : "desconectada"}</span>
            {/if}
          </td>
          <td>
            <div>{m.name}{#if m.id === app.team.myId} <span class="muted small">(tú)</span>{/if}</div>
            <div class="mono small muted">{m.login}</div>
          </td>
          <td>
            {#each m.roleIds as rid (rid)}
              {@const r = app.team.role(rid)}
              {#if r}<span class="chip" style:color={r.color} style:border-color={r.color}>{r.name}</span>{/if}
            {:else}
              <span class="muted small">sin rol</span>
            {/each}
          </td>
          <td class="row-actions">
            <button class="ghost" onclick={() => (editing = m)}>Editar</button>
            {#if m.id === app.team.myId}
              <!-- A uno mismo no: se quedaría fuera. -->
            {:else if m.disabled}
              <button class="ghost" onclick={() => setDisabled(m, false)}>Reactivar</button>
            {:else if confirmDisable === m.id}
              <span class="small">¿Desactivar a {m.name}?</span>
              <button class="no" onclick={() => setDisabled(m, true)}>Sí, desactivar</button>
              <button class="ghost" onclick={() => (confirmDisable = null)}>No</button>
            {:else if !canDisableMember(app.team.team, m.id)}
              <button class="ghost" disabled title={LAST_ADMIN_HINT}>Desactivar</button>
              <span class="muted small">{LAST_ADMIN_HINT}</span>
            {:else}
              <button class="ghost" onclick={() => (confirmDisable = m.id)}>Desactivar</button>
            {/if}
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
  {#if error}<div class="error">{error}</div>{/if}
{/if}
