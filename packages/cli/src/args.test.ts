import { describe, expect, test } from "bun:test";
import { CliArgError, parseCliArgs } from "./args";

describe("parseCliArgs", () => {
  test("ayuda y versión", () => {
    expect(parseCliArgs([])).toEqual({ cmd: "help" });
    expect(parseCliArgs(["--help"])).toEqual({ cmd: "help" });
    expect(parseCliArgs(["--version"])).toEqual({ cmd: "version" });
  });

  test("server pasa el resto tal cual a parseServerArgs", () => {
    expect(parseCliArgs(["server", "--dev", "--port", "5000"])).toEqual({ cmd: "server", argv: ["--dev", "--port", "5000"] });
  });

  test("mcp y doctor no admiten argumentos", () => {
    expect(parseCliArgs(["mcp"])).toEqual({ cmd: "mcp" });
    expect(() => parseCliArgs(["mcp", "x"])).toThrow(CliArgError);
    expect(parseCliArgs(["doctor"])).toEqual({ cmd: "doctor" });
  });

  test("hook nunca lanza: estado desconocido → null", () => {
    expect(parseCliArgs(["hook", "working"])).toEqual({ cmd: "hook", status: "working" });
    expect(parseCliArgs(["hook", "idle"])).toEqual({ cmd: "hook", status: "idle" });
    expect(parseCliArgs(["hook", "otro"])).toEqual({ cmd: "hook", status: null });
    expect(parseCliArgs(["hook"])).toEqual({ cmd: "hook", status: null });
  });

  test("claude: sesión, canal y args después de --", () => {
    expect(parseCliArgs(["claude"])).toEqual({ cmd: "claude", session: undefined, channel: "auto", passthrough: [] });
    expect(parseCliArgs(["claude", "--session", "api", "--channel", "plugin", "--", "--model", "opus", "--session", "x"])).toEqual({
      cmd: "claude", session: "api", channel: "plugin", passthrough: ["--model", "opus", "--session", "x"],
    });
    expect(parseCliArgs(["claude"], { DEVI_CHANNEL: "dev" })).toMatchObject({ channel: "dev" });
    expect(() => parseCliArgs(["claude", "--channel", "x"])).toThrow(CliArgError);
    expect(() => parseCliArgs(["claude", "--model", "opus"])).toThrow(/después de --/);
    expect(() => parseCliArgs(["claude", "--session"])).toThrow(/necesita un valor/);
  });

  test("install-integration", () => {
    expect(parseCliArgs(["install-integration"])).toEqual({
      cmd: "install-integration", from: undefined, binDir: undefined, marketplaceDir: undefined, skipClaude: false, json: false,
    });
    expect(parseCliArgs(["install-integration", "--from", "/a/devi", "--bin-dir", "/b", "--marketplace-dir", "/m", "--no-claude", "--json"])).toEqual({
      cmd: "install-integration", from: "/a/devi", binDir: "/b", marketplaceDir: "/m", skipClaude: true, json: true,
    });
    expect(() => parseCliArgs(["install-integration", "--nope"])).toThrow(CliArgError);
  });

  test("comando desconocido", () => {
    expect(() => parseCliArgs(["volar"])).toThrow(/comando desconocido: volar/);
  });
});
