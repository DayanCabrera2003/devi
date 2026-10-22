<script lang="ts">
  // «Pedírselo a otra persona»: elige a alguien del equipo y el servidor crea una solicitud nueva con el mismo
  // mensaje y archivos; la original se cierra con la nota «Reenviada a …».
  import type { DeviRequest } from "@devi/protocol";
  import PersonPicker from "../components/PersonPicker.svelte";
  import { useApp } from "../lib/context";
  import { reassignCandidates } from "../lib/reassign";

  type Props = { request: DeviRequest; primary?: boolean };
  let { request, primary = false }: Props = $props();
  const app = useApp();

  let open = $state(false);
  const people = $derived(reassignCandidates(app.team.team, app.team.myId, request.toMemberId));

  async function pick(id: string) {
    await app.reassign(request, id);
    open = false;
  }
</script>

<button class:primary onclick={() => (open = true)}>Pedírselo a otra persona</button>
{#if open}
  <PersonPicker
    {people}
    title="¿A quién se lo pides?"
    hint="Le llegará el mismo mensaje con los mismos archivos. La solicitud a {app.team.nameOf(request.toMemberId)} se cerrará."
    onPick={pick}
    onBack={() => (open = false)}
  />
{/if}
