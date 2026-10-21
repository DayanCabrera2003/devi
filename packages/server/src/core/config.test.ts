import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { defaultDataDir, parseServerArgs, testConfig } from "./config";

describe("defaultDataDir", () => {
  test("por sistema operativo", () => {
    expect(defaultDataDir("linux", {}, "/home/a")).toBe("/home/a/.local/share/devi");
    expect(defaultDataDir("linux", { XDG_DATA_HOME: "/x" }, "/home/a")).toBe("/x/devi");
    expect(defaultDataDir("darwin", {}, "/Users/a")).toBe("/Users/a/Library/Application Support/Devi");
    expect(defaultDataDir("win32", { APPDATA: "C:\\Users\\a\\AppData\\Roaming" }, "C:\\Users\\a")).toBe(
      "C:\\Users\\a\\AppData\\Roaming\\Devi",
    );
  });
});

describe("parseServerArgs", () => {
  const base = { platform: "linux" as const, env: {}, home: "/home/a" };
  test("valores por defecto", () => {
    expect(parseServerArgs([], base)).toEqual({
      port: 4747, host: "127.0.0.1", dataDir: "/home/a/.local/share/devi", dev: false,
      adminLogin: undefined, importTeam: undefined, socket: undefined,
    });
  });
  test("flags", () => {
    const c = parseServerArgs(["--port", "5000", "--data-dir", "/d", "--admin", "dayan@x", "--import", "team.json"], base);
    expect(c).toMatchObject({ port: 5000, dataDir: "/d", adminLogin: "dayan@x", importTeam: "team.json" });
  });
  test("modo dev por flag o DEVI_DEV=1", () => {
    expect(parseServerArgs(["--dev"], base).dev).toBe(true);
    expect(parseServerArgs([], { ...base, env: { DEVI_DEV: "1" } }).dev).toBe(true);
  });
  test("--socket: socket Unix en vez de puerto; excluyente con --port", () => {
    expect(parseServerArgs(["--socket", "/run/devi/devi.sock"], base).socket).toBe("/run/devi/devi.sock");
    expect(() => parseServerArgs(["--socket", "/s", "--port", "5000"], base)).toThrow("--socket");
    expect(() => parseServerArgs(["--port", "5000", "--socket", "/s"], base)).toThrow("--socket");
    expect(() => parseServerArgs(["--socket"], base)).toThrow();
  });
  test("rechaza flags desconocidos y puertos inválidos", () => {
    expect(() => parseServerArgs(["--nope"], base)).toThrow();
    expect(() => parseServerArgs(["--port", "abc"], base)).toThrow();
  });
});

describe("testConfig", () => {
  test("valores por defecto y dataDir único sin crear", () => {
    const a = testConfig();
    const b = testConfig({ dev: false });
    expect(a).toMatchObject({ port: 0, host: "127.0.0.1", dev: true, adminLogin: undefined, importTeam: undefined });
    expect(a.dataDir.startsWith(tmpdir())).toBe(true);
    expect(a.dataDir).not.toBe(b.dataDir);
    expect(existsSync(a.dataDir)).toBe(false);
    expect(b.dev).toBe(false);
  });
});
