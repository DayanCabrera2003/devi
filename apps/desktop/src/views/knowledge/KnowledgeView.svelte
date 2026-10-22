<script lang="ts">
  // «Base del equipo»: respuestas que sus autores guardaron al responder. Buscar y, si respondí yo (o soy
  // admin), retirar. Todo es texto de compañeros: se pinta como texto, nunca {@html}, y se avisa si parece
  // una inyección.
  import { type KnowledgeEntry, scanForInjection } from "@devi/protocol";
  import Icon from "../../components/Icon.svelte";
  import InjectionWarning from "../../components/InjectionWarning.svelte";
  import { errorMessage } from "../../lib/api";
  import { useApp } from "../../lib/context";
  import Page from "../Page.svelte";

  const LIMIT = 30;
  const app = useApp();

  let query = $state("");
  let searched = $state("");
  let entries = $state<KnowledgeEntry[]>([]);
  let loading = $state(false);
  let loaded = $state(false);
  let error = $state<string | null>(null);
  let busy = $state<string | null>(null);

  async function load(q: string) {
    loading = true;
    error = null;
    try {
      entries = (await app.call((api) => api.searchKnowledge(q, LIMIT))).entries;
      searched = q;
      loaded = true;
    } catch (e) {
      error = errorMessage(e);
    } finally {
      loading = false;
    }
  }

  // Al abrir y cada vez que una respuesta mía entra en la base, se recarga la búsqueda actual.
  $effect(() => {
    void app.knowledgeVersion;
    void load(searched);
  });

  function submit(e: SubmitEvent) {
    e.preventDefault();
    void load(query.trim());
  }

  const canWithdraw = (e: KnowledgeEntry) => e.answeredBy === app.team.myId || app.team.isAdmin;

  async function withdraw(e: KnowledgeEntry) {
    busy = e.id;
    error = null;
    try {
      await app.call((api) => api.withdrawKnowledge(e.id));
      entries = entries.filter((x) => x.id !== e.id);
    } catch (err) {
      error = errorMessage(err);
    } finally {
      busy = null;
    }
  }

  const day = (at: number) => new Date(at).toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" });
</script>

<Page title="Base del equipo">
  <p class="muted small intro">
    Respuestas que tus compañeros guardaron al responder. Tu agente busca aquí antes de recomendarte a quién pedir algo.
  </p>
  <form class="search glass flat" onsubmit={submit} role="search">
    <Icon name="search" />
    <input type="search" placeholder="Buscar (p. ej. desplegar staging)" aria-label="Buscar en la base del equipo" bind:value={query} />
  </form>

  {#if error}<div class="error">{error}</div>{/if}

  {#if loaded && entries.length === 0}
    <p class="empty">
      {searched ? `Nada sobre «${searched}» en la base del equipo.` : "Todavía no hay nada en la base del equipo. Al responder, marca «Guardar en la base del equipo»."}
    </p>
  {:else}
    <ul class="kb-list">
      {#each entries as e (e.id)}
        <li class="kb-item glass flat">
          <div class="kb-meta small muted">{e.answeredByName} explicó esto el {day(e.createdAt)} · preguntó {e.askedByName}</div>
          <p class="kb-q">{e.question}</p>
          <p class="kb-a card-msg">{e.answer}</p>
          <InjectionWarning scan={scanForInjection(`${e.question}\n${e.answer}`)} />
          {#if canWithdraw(e)}
            <div class="actions">
              <button class="no" disabled={busy === e.id} aria-label="Retirar de la base del equipo" onclick={() => withdraw(e)}>Retirar</button>
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
  {#if loading}<div class="muted small">Buscando…</div>{/if}
</Page>

<style>
  .intro { margin: 0 0 12px; }
  .search { margin-bottom: 14px; }
  .kb-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
  .kb-item { padding: 12px 14px; border-radius: 12px; }
  .kb-q { font-weight: 600; margin: 6px 0 4px; white-space: pre-wrap; overflow-wrap: anywhere; }
  .kb-a { margin: 0; }
</style>
