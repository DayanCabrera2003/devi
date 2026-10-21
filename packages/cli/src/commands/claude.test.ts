import { expect, test } from "bun:test";
import { buildClaudeArgs, sessionNameFor } from "./claude";

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
