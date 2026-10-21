<script lang="ts">
  import type { Member } from "@devi/protocol";
  import { type MemberBody, errorMessage } from "../../lib/api";
  import { useApp } from "../../lib/context";
  import MemberForm from "./MemberForm.svelte";

  const app = useApp();
  let editing = $state<Member | null>(null);
  let inviting = $state(false);
  let error = $state<string | null>(null);
  const members = $derived(app.team.team.members);
  const roles = $derived(app.team.team.roles);

  // Si falla, el error lo muestra MemberForm y el formulario sigue abierto.
  async function save(body: MemberBody) {
    const current = editing;
    if (current) await app.admin((a) => a.updateMember(current.id, body));
    else await app.admin((a) => a.createMember(body));
    close();
  }

  async function setDisabled(m: Member, disabled: boolean) {
    error = null;
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
    <MemberForm member={editing} {roles} onSave={save} onCancel={close} />
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
            {#if m.id !== app.team.myId}
              <button class="ghost" onclick={() => setDisabled(m, !m.disabled)}>{m.disabled ? "Reactivar" : "Desactivar"}</button>
            {/if}
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
  {#if error}<div class="error">{error}</div>{/if}
{/if}
