import { createClient } from "@devi/client";
import { loadClientConfig } from "../config";
import { debugPairing, pairing } from "../pairing";
import type { Sys } from "../paths";

export const HOOK_DEADLINE_MS = 1000;

type HookInput = { session_id?: unknown; cwd?: unknown; hook_event_name?: unknown };

export function parseHookInput(text: string): { claudeSessionId: string; cwd: string } | null {
  try {
    const j = JSON.parse(text) as HookInput;
    if (typeof j.session_id !== "string" || typeof j.cwd !== "string") return null;
    return { claudeSessionId: j.session_id, cwd: j.cwd };
  } catch {
    return null;
  }
}

// `devi hook working|idle`: avisa al servidor del estado de la sesión. Nunca falla ni bloquea:
// cualquier error se ignora y todo el trabajo tiene un plazo de 1 s.
export async function runHook(
  status: "working" | "idle" | null,
  sys: Sys,
  readStdin: () => Promise<string> = () => Bun.stdin.text(),
): Promise<void> {
  if (!status) return;
  const deadline = new Promise<void>((resolve) => setTimeout(resolve, HOOK_DEADLINE_MS).unref());
  const work = (async () => {
    const input = parseHookInput(await readStdin());
    debugPairing("hook", { status, claudeSessionId: input?.claudeSessionId });
    if (!input) return;
    const cfg = await loadClientConfig(sys);
    const signal = AbortSignal.timeout(HOOK_DEADLINE_MS);
    const client = createClient({
      baseUrl: cfg.serverUrl,
      devUser: cfg.devUser,
      fetch: ((url: string, init?: RequestInit) => fetch(url, { ...init, signal })) as typeof fetch,
    });
    await client.call("sessionHook", { body: { ...input, parentPid: pairing().parentPid, status } });
  })().catch(() => {});
  await Promise.race([work, deadline]);
}
