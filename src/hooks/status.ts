// Hook de Claude Code: marca la sesión como trabajando (UserPromptSubmit) o libre (Stop).
// Uso: bun src/hooks/status.ts working|idle — nunca falla ni bloquea la sesión.
const status = process.argv[2];
const user = process.env.DEVI_USER;
const name = process.env.DEVI_SESSION;
const hub = process.env.DEVI_HUB_URL ?? "http://localhost:4747";

if (user && name && (status === "working" || status === "idle")) {
  try {
    await fetch(`${hub}/api/sessions/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user, name, status }),
      signal: AbortSignal.timeout(1000),
    });
  } catch {
    // el hub no está: ignorar
  }
}
process.exit(0);
