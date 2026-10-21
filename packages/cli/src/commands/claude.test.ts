import { expect, test } from "bun:test";
import { buildClaudeArgs, claudeEnv, sessionNameFor } from "./claude";

test("nombre de sesión: --session o la carpeta actual", () => {
  expect(sessionNameFor("api", "/home/a/proyecto")).toBe("api");
  expect(sessionNameFor(undefined, "/home/a/proyecto")).toBe("proyecto");
  expect(sessionNameFor(undefined, "/")).toBe("sesion");
});

test("args de claude: canal, --name y los args extra al final", () => {
  expect(buildClaudeArgs({ session: "api", mode: "dev", passthrough: ["--model", "opus"] })).toEqual([
    "--dangerously-load-development-channels", "plugin:devi@devi-local", "--name", "api", "--model", "opus",
  ]);
  expect(buildClaudeArgs({ session: "api", mode: "plugin", passthrough: [] })).toEqual([
    "--channels", "plugin:devi@devi-local", "--name", "api",
  ]);
});

test("env de claude: DEVI_SESSION y DEVI_CHANNEL=1 solo si se pasa un flag de canal", () => {
  const base = { PATH: "/bin", DEVI_CHANNEL: "dev" };
  expect(claudeEnv(base, "api", buildClaudeArgs({ session: "api", mode: "plugin", passthrough: [] }))).toEqual({
    PATH: "/bin", DEVI_SESSION: "api", DEVI_CHANNEL: "1",
  });
  expect(claudeEnv(base, "api", buildClaudeArgs({ session: "api", mode: "dev", passthrough: [] })).DEVI_CHANNEL).toBe("1");
  expect(claudeEnv(base, "api", ["--name", "api"])).toEqual({ PATH: "/bin", DEVI_SESSION: "api" });
});
