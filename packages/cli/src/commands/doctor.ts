import { createClient } from "@devi/client";
import { MANAGED_SETTINGS_SNIPPET, decideChannelMode, readChannelPolicy, type ChannelPolicy } from "../channel-policy";
import { ConfigError, loadClientConfig } from "../config";
import { readableError } from "../mcp/errors";
import { PLUGIN_ID, type Sys } from "../paths";
import { CLAUDE_NOT_FOUND } from "../claude-bin";
import { run } from "../proc";

export type Check = { name: string; ok: boolean; detail: string; fix?: string };

// `tailscale status --json`: ¿conectado? y login de este equipo.
export function parseTailscaleStatus(text: string): { running: boolean; login: string | null } {
  try {
    const j = JSON.parse(text) as {
      BackendState?: string;
      Self?: { UserID?: number; UserProfile?: { LoginName?: string } };
      User?: Record<string, { LoginName?: string }>;
    };
    const uid = j.Self?.UserID;
    const login = j.Self?.UserProfile?.LoginName ?? (uid !== undefined ? j.User?.[String(uid)]?.LoginName : undefined) ?? null;
    return { running: j.BackendState === "Running", login };
  } catch {
    return { running: false, login: null };
  }
}

export function pluginInstalled(listJson: string): { installed: boolean; enabled: boolean } {
  try {
    const list = JSON.parse(listJson) as { id?: string; enabled?: boolean }[];
    const p = Array.isArray(list) ? list.find((x) => x.id === PLUGIN_ID) : undefined;
    return { installed: !!p, enabled: !!p?.enabled };
  } catch {
    return { installed: false, enabled: false };
  }
}

export function channelCheck(policy: ChannelPolicy): Check {
  const mode = decideChannelMode("auto", policy);
  if (mode === "plugin") return { name: "Canal", ok: true, detail: "la organización permite el canal de Devi (devi claude usará --channels)" };
  if (policy.found && policy.channelsEnabled !== true) {
    return {
      name: "Canal",
      ok: false,
      detail: "las managed settings de la organización desactivan los canales: las solicitudes no entrarán solas en la sesión (la app sigue mostrando las tarjetas)",
      fix: `Pide al Owner que añada a las managed settings:\n${MANAGED_SETTINGS_SNIPPET}`,
    };
  }
  return {
    name: "Canal",
    ok: true,
    detail: "sin política de la organización en este equipo: devi claude usará el flag de desarrollo (Claude Code pedirá confirmarlo)",
    fix: `En organizaciones Team/Enterprise, el Owner puede permitirlo sin flag con:\n${MANAGED_SETTINGS_SNIPPET}`,
  };
}

export async function collectChecks(sys: Sys): Promise<Check[]> {
  const checks: Check[] = [];

  const ts = await run("tailscale", ["status", "--json"], { timeoutMs: 5000 });
  if (!ts) checks.push({ name: "Tailscale", ok: false, detail: "no está instalado", fix: "Instálalo desde https://tailscale.com/download y conéctate a la tailnet del equipo." });
  else {
    const s = parseTailscaleStatus(ts.stdout);
    checks.push(
      s.running
        ? { name: "Tailscale", ok: true, detail: `conectado como ${s.login ?? "?"}` }
        : { name: "Tailscale", ok: false, detail: "no está conectado", fix: "Ejecuta `tailscale up` (o abre la app de Tailscale) e inicia sesión." },
    );
  }

  let cfg;
  try {
    cfg = await loadClientConfig(sys);
    checks.push({ name: "Configuración", ok: true, detail: `${cfg.path} → ${cfg.serverUrl}${cfg.devUser ? ` (modo dev: ${cfg.devUser})` : ""}` });
  } catch (e) {
    checks.push({ name: "Configuración", ok: false, detail: (e as Error).message, fix: e instanceof ConfigError ? "Abre la app de Devi y completa el asistente." : undefined });
  }

  if (cfg) {
    const client = createClient({ baseUrl: cfg.serverUrl, devUser: cfg.devUser });
    try {
      const h = await client.call("health");
      checks.push({ name: "Servidor", ok: true, detail: `responde (versión ${h.version})` });
      try {
        const me = await client.call("me");
        checks.push({ name: "Login", ok: true, detail: `${me.login} → ${me.member.name} (${me.perms.join(", ") || "sin permisos"})` });
      } catch (e) {
        checks.push({ name: "Login", ok: false, detail: readableError(e) });
      }
    } catch (e) {
      checks.push({
        name: "Servidor",
        ok: false,
        detail: readableError(e),
        fix: "En la PC servidor: abre la app de Devi en modo servidor y ejecuta `tailscale serve --bg 4747`.",
      });
    }
  }

  const list = await run("claude", ["plugin", "list", "--json"], { timeoutMs: 15_000 });
  if (!list) checks.push({ name: "Claude Code", ok: false, detail: CLAUDE_NOT_FOUND, fix: "Instala Claude Code o define DEVI_CLAUDE_BIN con su ruta." });
  else {
    const p = pluginInstalled(list.stdout);
    checks.push(
      p.installed && p.enabled
        ? { name: "Plugin", ok: true, detail: `${PLUGIN_ID} instalado y activo` }
        : {
            name: "Plugin",
            ok: false,
            detail: p.installed ? `${PLUGIN_ID} está desactivado` : `${PLUGIN_ID} no está instalado`,
            fix: p.installed ? `claude plugin enable ${PLUGIN_ID}` : "Abre la app de Devi → Ajustes → Instalar integración (o ejecuta `devi install-integration`).",
          },
    );
  }

  checks.push(channelCheck(await readChannelPolicy(sys)));
  return checks;
}

export function formatChecks(checks: Check[]): string {
  return checks
    .map((c) => `${c.ok ? "✓" : "✗"} ${c.name}: ${c.detail}${c.fix ? `\n  → ${c.fix.replace(/\n/g, "\n    ")}` : ""}`)
    .join("\n");
}

export async function runDoctor(sys: Sys): Promise<number> {
  const checks = await collectChecks(sys);
  console.log(formatChecks(checks));
  return checks.every((c) => c.ok) ? 0 : 1;
}
