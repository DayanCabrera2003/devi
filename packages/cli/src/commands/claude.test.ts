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

test("args de claude: si el usuario pasa su propio --name/-n, no se añade otro", () => {
  for (const own of [["--name", "mio"], ["-n", "mio"], ["--name=mio"]]) {
    expect(buildClaudeArgs({ session: "api", mode: "plugin", passthrough: ["-c", ...own] })).toEqual([
      "--channels", "plugin:devi@devi-local", "-c", ...own,
    ]);
  }
  // Después de un `--` de claude ya no son flags: --name se añade igual.
  expect(buildClaudeArgs({ session: "api", mode: "plugin", passthrough: ["--", "-n"] })).toEqual([
    "--channels", "plugin:devi@devi-local", "--name", "api", "--", "-n",
  ]);
});

test("args de claude: -c y --resume se pasan tal cual", () => {
  expect(buildClaudeArgs({ session: "web", mode: "plugin", passthrough: ["-c"] })).toEqual([
    "--channels", "plugin:devi@devi-local", "--name", "web", "-c",
  ]);
  expect(buildClaudeArgs({ session: "web", mode: "plugin", passthrough: ["--resume", "abc"] })).toEqual([
    "--channels", "plugin:devi@devi-local", "--name", "web", "--resume", "abc",
  ]);
});
