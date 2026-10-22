import { basename } from "node:path";
import { createClient } from "@devi/client";
import { loadClientConfig } from "../config";
import { HANDOFF_MAX_CHARS, HANDOFF_MAX_CHARS_CMD, argvPrompt, prepareHandoff } from "../handoff";
import { readableError } from "../mcp/errors";
import type { ChannelMode } from "../args";
import { channelArgs, decideChannelMode, readChannelPolicy } from "../channel-policy";
import type { Sys } from "../paths";
import { CLAUDE_NOT_FOUND, claudeSpawnEnv, findClaude } from "../claude-bin";
import { spawnArgv } from "../proc";

export function sessionNameFor(session: string | undefined, cwd: string): string {
  return session ?? (basename(cwd) || "sesion");
}

// ¿El usuario ya pasa su propio --name/-n a claude? Solo cuentan los flags antes de un `--`.
export function hasOwnName(passthrough: string[]): boolean {
  const end = passthrough.indexOf("--");
  const flags = end === -1 ? passthrough : passthrough.slice(0, end);
  return flags.some((a) => a === "--name" || a === "-n" || a.startsWith("--name="));
}

// Con su propio --name no se añade el de Devi (DEVI_SESSION sigue saliendo de --session o la carpeta).
// prompt: mensaje inicial (p. ej. un traspaso); va al final, como argumento posicional de claude.
export function buildClaudeArgs(opts: { session: string; mode: "plugin" | "dev"; passthrough: string[]; prompt?: string }): string[] {
  const name = hasOwnName(opts.passthrough) ? [] : ["--name", opts.session];
  return [...channelArgs(opts.mode), ...name, ...opts.passthrough, ...(opts.prompt !== undefined ? [opts.prompt] : [])];
}

const CHANNEL_FLAGS = new Set(["--channels", "--dangerously-load-development-channels"]);

// Entorno de Claude Code: DEVI_SESSION y, solo si se le pasa un flag de canal, DEVI_CHANNEL=1.
// El MCP y los hooks lo heredan: con canal, el MCP entrega en tiempo real; sin él, los hooks recogen la bandeja.
export function claudeEnv(base: Record<string, string | undefined>, session: string, args: string[]): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...base, DEVI_SESSION: session };
  delete env.DEVI_CHANNEL;
  if (args.some((a) => CHANNEL_FLAGS.has(a))) env.DEVI_CHANNEL = "1";
  return env;
}

// `devi claude`: lanza Claude Code con el canal de Devi y espera a que termine (mismo código de salida).
export async function runClaude(
  opts: { session: string | undefined; channel: ChannelMode; passthrough: string[]; handoff?: string },
  sys: Sys,
): Promise<number> {
  const claude = await findClaude(sys.env, sys.platform, sys.home);
  if (!claude) {
    console.error(`[devi] ${CLAUDE_NOT_FOUND}`);
    return 127;
  }
  let prompt: string | undefined;
  if (opts.handoff !== undefined) {
    const viaCmd = sys.platform === "win32" && /\.(cmd|bat)$/i.test(claude);
    try {
      const cfg = await loadClientConfig(sys);
      const client = createClient({ baseUrl: cfg.serverUrl, devUser: cfg.devUser });
      const max = viaCmd ? HANDOFF_MAX_CHARS_CMD : HANDOFF_MAX_CHARS;
      prompt = argvPrompt(await prepareHandoff(opts.handoff, { client, receivedDir: cfg.receivedDir }, max), viaCmd);
    } catch (e) {
      console.error(`[devi] No se pudo abrir el traspaso ${opts.handoff}: ${readableError(e)}`);
      return 1;
    }
  }
  const mode = decideChannelMode(opts.channel, await readChannelPolicy(sys));
  const session = sessionNameFor(opts.session, process.cwd());
  if (mode === "dev") {
    console.error("[devi] cargando el canal en modo desarrollo: Claude Code pedirá confirmarlo al arrancar.");
  }
  const args = buildClaudeArgs({ session, mode, passthrough: opts.passthrough, prompt });
  const child = Bun.spawn(spawnArgv(claude, args, sys.platform), {
    stdio: ["inherit", "inherit", "inherit"],
    env: claudeSpawnEnv(claudeEnv(process.env, session, args), claude, sys.platform) as Record<string, string>,
  });
  // Ctrl+C es para Claude Code, no para este proceso.
  const ignore = () => {};
  process.on("SIGINT", ignore);
  const code = await child.exited;
  process.off("SIGINT", ignore);
  return code;
}
