import { describe, expect, test } from "bun:test";
import { claudeSpawnEnv, findClaude, type FindClaudeDeps } from "./claude-bin";

const HOME = "/home/ana";
function deps(over: Partial<FindClaudeDeps> & { files?: string[] } = {}): FindClaudeDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    which: () => null,
    isExecutable: (p) => (over.files ?? []).includes(p),
    probeShell: async (shell, env) => {
      calls.push(`${shell}|${env.DEVI_NO_ALIAS}`);
      return null;
    },
    ...over,
  };
}

describe("findClaude", () => {
  test("el override CLAUDE_BIN / DEVI_CLAUDE_BIN gana sobre todo", async () => {
    const d = deps({ files: ["/x/claude", "/y/claude"], which: () => "/usr/bin/claude" });
    expect(await findClaude({ CLAUDE_BIN: "/x/claude", DEVI_CLAUDE_BIN: "/y/claude" }, "linux", HOME, d)).toBe("/x/claude");
    expect(await findClaude({ DEVI_CLAUDE_BIN: "/y/claude" }, "linux", HOME, d)).toBe("/y/claude");
  });

  test("un override que no existe se ignora y se sigue buscando", async () => {
    const d = deps({ which: () => "/usr/bin/claude" });
    expect(await findClaude({ DEVI_CLAUDE_BIN: "/no/existe" }, "linux", HOME, d)).toBe("/usr/bin/claude");
  });

  test("usa el PATH actual si lo encuentra", async () => {
    expect(await findClaude({}, "linux", HOME, deps({ which: () => "/opt/x/claude" }))).toBe("/opt/x/claude");
  });

  test("sin PATH, encuentra ~/.local/bin/claude (app lanzada desde el menú)", async () => {
    const d = deps({ files: [`${HOME}/.local/bin/claude`] });
    expect(await findClaude({ PATH: "/usr/sbin" }, "linux", HOME, d)).toBe(`${HOME}/.local/bin/claude`);
    expect(d.calls).toEqual([]);
  });

  test("respeta el orden de las rutas conocidas", async () => {
    const d = deps({ files: ["/usr/bin/claude", `${HOME}/.bun/bin/claude`] });
    expect(await findClaude({}, "darwin", HOME, d)).toBe(`${HOME}/.bun/bin/claude`);
    expect(await findClaude({}, "darwin", HOME, deps({ files: ["/opt/homebrew/bin/claude"] }))).toBe("/opt/homebrew/bin/claude");
  });

  test("Windows: rutas de usuario y sin consulta al shell", async () => {
    const env = { USERPROFILE: "C:\\Users\\Ana", APPDATA: "C:\\Users\\Ana\\AppData\\Roaming", LOCALAPPDATA: "C:\\Users\\Ana\\AppData\\Local" };
    const npm = "C:\\Users\\Ana\\AppData\\Roaming\\npm\\claude.cmd";
    const d = deps({ files: [npm] });
    expect(await findClaude(env, "win32", "C:\\Users\\Ana", d)).toBe(npm);
    const native = "C:\\Users\\Ana\\.local\\bin\\claude.exe";
    expect(await findClaude(env, "win32", "C:\\Users\\Ana", deps({ files: [native] }))).toBe(native);
    const none = deps();
    expect(await findClaude(env, "win32", "C:\\Users\\Ana", none)).toBeNull();
    expect(none.calls).toEqual([]);
  });

  test("pregunta al shell de login con DEVI_NO_ALIAS=1 y toma la última línea", async () => {
    const d = deps({
      files: ["/custom/claude"],
      probeShell: async (shell, env) => (shell === "/bin/zsh" && env.DEVI_NO_ALIAS === "1" ? "ruido del rc\n\n/custom/claude\n" : null),
    });
    expect(await findClaude({ SHELL: "/bin/zsh" }, "linux", HOME, d)).toBe("/custom/claude");
  });

  test("ignora resultados no absolutos (la función `claude` del alias) o no ejecutables", async () => {
    expect(await findClaude({ SHELL: "/bin/zsh" }, "linux", HOME, deps({ probeShell: async () => "claude" }))).toBeNull();
    expect(await findClaude({ SHELL: "/bin/zsh" }, "linux", HOME, deps({ probeShell: async () => "/nope/claude" }))).toBeNull();
  });

  test("sin $SHELL no consulta al shell; si el probe lanza, devuelve null", async () => {
    const d = deps();
    expect(await findClaude({}, "linux", HOME, d)).toBeNull();
    expect(d.calls).toEqual([]);
    const boom = deps({ probeShell: async () => { throw new Error("timeout"); } });
    expect(await findClaude({ SHELL: "/bin/zsh" }, "linux", HOME, boom)).toBeNull();
  });
});

describe("claudeSpawnEnv", () => {
  test("antepone el directorio de claude al PATH", () => {
    expect(claudeSpawnEnv({ PATH: "/usr/bin" }, "/home/ana/.local/bin/claude", "linux").PATH).toBe("/home/ana/.local/bin:/usr/bin");
    expect(claudeSpawnEnv({}, "/home/ana/.local/bin/claude", "linux").PATH).toBe("/home/ana/.local/bin");
    expect(claudeSpawnEnv({ Path: "C:\\w" }, "C:\\n\\claude.cmd", "win32").Path).toBe("C:\\n;C:\\w");
  });
});
