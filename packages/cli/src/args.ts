// Parser de argumentos de `devi`. Sin dependencias: cada subcomando tiene pocos flags.
export type ChannelMode = "auto" | "plugin" | "dev";

export type CliCommand =
  | { cmd: "help" }
  | { cmd: "version" }
  | { cmd: "server"; argv: string[] }
  | { cmd: "mcp" }
  | { cmd: "hook"; status: "working" | "idle" | null }
  | { cmd: "claude"; session: string | undefined; channel: ChannelMode; passthrough: string[] }
  | { cmd: "doctor" }
  | { cmd: "shell-alias"; action: "install" | "remove" | "status"; json: boolean }
  | {
      cmd: "install-integration";
      from: string | undefined;
      binDir: string | undefined;
      marketplaceDir: string | undefined;
      skipClaude: boolean;
      json: boolean;
    };

export class CliArgError extends Error {}

export const USAGE = `Uso: devi <comando>

  server [--port N] [--data-dir DIR] [--admin LOGIN] [--import team.json] [--dev]
                         Arranca el servidor del equipo
  mcp                    Servidor MCP + canal (lo lanza Claude Code, no a mano)
  hook <working|idle>    Hook de Claude Code (lee el JSON del hook por stdin)
  claude [--session NOMBRE] [--channel auto|plugin|dev] [-- args de claude]
                         Lanza Claude Code con el canal de Devi cargado
  doctor                 Diagnostica Tailscale, servidor, login, plugin y canal
  install-integration [--from BINARIO] [--bin-dir DIR] [--marketplace-dir DIR] [--no-claude] [--json]
                         Instala el binario en una ruta estable y el plugin de Claude Code
  shell-alias install|remove|status [--json]
                         Hace que escribir \`claude\` en la terminal equivalga a \`devi claude\`
  --version              Muestra la versión`;

function takeValue(argv: string[], i: number, flag: string): string {
  const v = argv[i + 1];
  if (v === undefined || v.startsWith("--")) throw new CliArgError(`${flag} necesita un valor`);
  return v;
}

export function parseCliArgs(argv: string[], env: Record<string, string | undefined> = {}): CliCommand {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case undefined:
    case "help":
    case "--help":
    case "-h":
      return { cmd: "help" };
    case "--version":
    case "-v":
    case "version":
      return { cmd: "version" };
    case "server":
      return { cmd: "server", argv: rest };
    case "mcp":
      if (rest.length > 0) throw new CliArgError(`devi mcp no admite argumentos: ${rest.join(" ")}`);
      return { cmd: "mcp" };
    case "hook": {
      // Nunca falla: un estado desconocido se ignora (el hook no debe molestar a la sesión).
      const s = rest[0];
      return { cmd: "hook", status: s === "working" || s === "idle" ? s : null };
    }
    case "doctor":
      if (rest.length > 0) throw new CliArgError(`devi doctor no admite argumentos: ${rest.join(" ")}`);
      return { cmd: "doctor" };
    case "claude":
      return parseClaude(rest, env);
    case "install-integration":
      return parseInstall(rest);
    case "shell-alias":
      return parseShellAlias(rest);
    default:
      throw new CliArgError(`comando desconocido: ${cmd}\n\n${USAGE}`);
  }
}

function parseChannel(v: string | undefined): ChannelMode {
  if (v === undefined || v === "") return "auto";
  if (v === "auto" || v === "plugin" || v === "dev") return v;
  throw new CliArgError(`--channel debe ser auto, plugin o dev (recibido: ${v})`);
}

function parseClaude(argv: string[], env: Record<string, string | undefined>): CliCommand {
  let session: string | undefined;
  let channel = parseChannel(env.DEVI_CHANNEL);
  let passthrough: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--") {
      passthrough = argv.slice(i + 1);
      break;
    } else if (a === "--session") session = takeValue(argv, i++, a);
    else if (a === "--channel") channel = parseChannel(takeValue(argv, i++, a));
    else throw new CliArgError(`argumento desconocido para devi claude: ${a} (los de claude van después de --)`);
  }
  if (session !== undefined && session.trim() === "") throw new CliArgError("--session no puede estar vacío");
  return { cmd: "claude", session, channel, passthrough };
}

function parseShellAlias(argv: string[]): CliCommand {
  const [action, ...flags] = argv;
  if (action !== "install" && action !== "remove" && action !== "status") {
    throw new CliArgError(`devi shell-alias necesita install, remove o status${action ? ` (recibido: ${action})` : ""}`);
  }
  let json = false;
  for (const a of flags) {
    if (a === "--json") json = true;
    else throw new CliArgError(`argumento desconocido para shell-alias: ${a}`);
  }
  return { cmd: "shell-alias", action, json };
}

function parseInstall(argv: string[]): CliCommand {
  const out = {
    cmd: "install-integration" as const,
    from: undefined as string | undefined,
    binDir: undefined as string | undefined,
    marketplaceDir: undefined as string | undefined,
    skipClaude: false,
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--from") out.from = takeValue(argv, i++, a);
    else if (a === "--bin-dir") out.binDir = takeValue(argv, i++, a);
    else if (a === "--marketplace-dir") out.marketplaceDir = takeValue(argv, i++, a);
    else if (a === "--no-claude") out.skipClaude = true;
    else if (a === "--json") out.json = true;
    else throw new CliArgError(`argumento desconocido para install-integration: ${a}`);
  }
  return out;
}
