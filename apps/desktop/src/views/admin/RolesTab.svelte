<script lang="ts">
  import type { RoleBody } from "../../lib/api";
  import { useApp } from "../../lib/context";
  import RoleEditor from "./RoleEditor.svelte";

  const app = useApp();
  let selected = $state<string | null>(null); // id del rol, "nuevo" o null
  // Cambia solo cuando el admin elige otro rol: al crear uno, el editor sigue montado (y su «Guardado.»).
  let editorKey = $state(0);
  const roles = $derived(app.team.team.roles);
  const role = $derived(selected && selected !== "nuevo" ? (roles.find((r) => r.id === selected) ?? null) : null);
  const usage = (id: string) => app.team.team.members.filter((m) => m.roleIds.includes(id)).length;

  function select(id: string | null) {
    selected = id;
    editorKey++;
  }

  async function save(body: RoleBody) {
    const current = role;
    if (current) await app.admin((a) => a.updateRole(current.id, body));
    else {
      const created = await app.admin((a) => a.createRole(body));
      selected = created.id;
    }
  }

  async function remove() {
    const current = role;
    if (!current) return;
    await app.admin((a) => a.deleteRole(current.id));
    select(null);
  }
</script>

<div class="split">
  <div class="role-list">
    {#each roles as r (r.id)}
      <button class="role-item" class:active={selected === r.id} onclick={() => select(r.id)}>
        <span class="chip" style:--role={r.color}>{r.name}</span>
        <span class="muted small" title="Personas con este rol">{usage(r.id)}</span>
      </button>
    {/each}
    <button class="ghost" class:active={selected === "nuevo"} onclick={() => select("nuevo")}>+ Nuevo rol</button>
  </div>
  <div>
    {#if selected}
      {#key editorKey}
        <RoleEditor {role} team={app.team.team} onSave={save} onDelete={role ? remove : undefined} onCancel={() => select(null)} />
      {/key}
    {:else}
      <div class="empty small">Elige un rol o crea uno nuevo.</div>
    {/if}
  </div>
</div>
