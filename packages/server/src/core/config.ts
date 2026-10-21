import { join, win32 } from "node:path";

export type ServerConfig = {
  port: number;
  host: "127.0.0.1"; // siempre loopback: en producción lo publica `tailscale serve`
  dataDir: string;
  dev: boolean;
  adminLogin: string | undefined;
  importTeam: string | undefined;
};

type Env = Record<string, string | undefined>;

export function defaultDataDir(platform: NodeJS.Platform, env: Env, home: string): string {
  if (platform === "win32") return win32.join(env.APPDATA ?? win32.join(home, "AppData", "Roaming"), "Devi");
  if (platform === "darwin") return join(home, "Library", "Application Support", "Devi");
  return join(env.XDG_DATA_HOME ?? join(home, ".local", "share"), "devi");
}

// devi server [--port N] [--data-dir DIR] [--admin LOGIN] [--import team.json] [--dev]
export function parseServerArgs(argv: string[], sys: { platform: NodeJS.Platform; env: Env; home: string }): ServerConfig {
  const cfg: ServerConfig = {
    port: 4747,
    host: "127.0.0.1",
    dataDir: defaultDataDir(sys.platform, sys.env, sys.home),
    dev: sys.env.DEVI_DEV === "1",
    adminLogin: undefined,
    importTeam: undefined,
  };
  const value = (i: number, flag: string) => {
    const v = argv[i + 1];
    if (!v || v.startsWith("--")) throw new Error(`${flag} necesita un valor`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--port") {
      const n = Number(value(i++, a));
      if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error(`puerto inválido: ${argv[i]}`);
      cfg.port = n;
    } else if (a === "--data-dir") cfg.dataDir = value(i++, a);
    else if (a === "--admin") cfg.adminLogin = value(i++, a);
    else if (a === "--import") cfg.importTeam = value(i++, a);
    else if (a === "--dev") cfg.dev = true;
    else throw new Error(`argumento desconocido: ${a}`);
  }
  return cfg;
}
