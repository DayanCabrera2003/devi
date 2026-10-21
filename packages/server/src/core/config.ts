import { tmpdir } from "node:os";
import { DomainSchema } from "@devi/protocol";
import { join, win32 } from "node:path";

export type ServerConfig = {
  port: number;
  host: "127.0.0.1"; // siempre loopback: en producción lo publica `tailscale serve`
  // Socket Unix en vez de puerto TCP (producción). Con 127.0.0.1:<puerto> cualquier proceso local
  // puede conectarse y falsificar Tailscale-User-Login; el socket queda en 0600 y solo llegan su
  // dueño y root (tailscaled, que hace `tailscale serve unix:<ruta>`).
  socket: string | undefined;
  dataDir: string;
  dev: boolean;
  adminLogin: string | undefined;
  importTeam: string | undefined;
  // --allowed-domain (repetible): se añaden al ajuste persistido allowedDomains al arrancar.
  allowedDomains: string[];
};

type Env = Record<string, string | undefined>;

export function defaultDataDir(platform: NodeJS.Platform, env: Env, home: string): string {
  if (platform === "win32") return win32.join(env.APPDATA ?? win32.join(home, "AppData", "Roaming"), "Devi");
  if (platform === "darwin") return join(home, "Library", "Application Support", "Devi");
  return join(env.XDG_DATA_HOME ?? join(home, ".local", "share"), "devi");
}

// devi server [--port N | --socket RUTA] [--data-dir DIR] [--admin LOGIN] [--allowed-domain DOMINIO]...
//             [--import team.json] [--dev]
export function parseServerArgs(argv: string[], sys: { platform: NodeJS.Platform; env: Env; home: string }): ServerConfig {
  const cfg: ServerConfig = {
    port: 4747,
    host: "127.0.0.1",
    dataDir: defaultDataDir(sys.platform, sys.env, sys.home),
    dev: sys.env.DEVI_DEV === "1",
    adminLogin: undefined,
    importTeam: undefined,
    socket: undefined,
    allowedDomains: [],
  };
  let portGiven = false;
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
      portGiven = true;
    } else if (a === "--socket") cfg.socket = value(i++, a);
    else if (a === "--allowed-domain") {
      const raw = value(i++, a);
      const d = DomainSchema.safeParse(raw);
      if (!d.success) throw new Error(`--allowed-domain: dominio inválido "${raw}" (p. ej. empresa.com, sin @)`);
      if (!cfg.allowedDomains.includes(d.data)) cfg.allowedDomains.push(d.data);
    }
    else if (a === "--data-dir") cfg.dataDir = value(i++, a);
    else if (a === "--admin") cfg.adminLogin = value(i++, a);
    else if (a === "--import") cfg.importTeam = value(i++, a);
    else if (a === "--dev") cfg.dev = true;
    else throw new Error(`argumento desconocido: ${a}`);
  }
  if (cfg.socket && portGiven) throw new Error("--socket y --port son excluyentes: usa uno de los dos");
  return cfg;
}

// Config para tests: puerto efímero, dev activo y un dataDir único que NO se crea aquí.
export function testConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    port: 0,
    host: "127.0.0.1",
    dataDir: join(tmpdir(), `devi-test-${crypto.randomUUID()}`),
    dev: true,
    adminLogin: undefined,
    importTeam: undefined,
    socket: undefined,
    allowedDomains: [],
    ...overrides,
  };
}
