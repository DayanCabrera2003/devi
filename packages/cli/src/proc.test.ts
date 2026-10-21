import { expect, test } from "bun:test";
import { quoteCmdArg, spawnArgv } from "./proc";

test("spawnArgv: directo salvo .cmd en Windows", () => {
  expect(spawnArgv("/usr/bin/claude", ["--name", "a b"], "linux")).toEqual(["/usr/bin/claude", "--name", "a b"]);
  expect(spawnArgv("C:\\x\\claude.exe", ["a"], "win32")).toEqual(["C:\\x\\claude.exe", "a"]);
  expect(spawnArgv("C:\\npm\\claude.cmd", ["plugin", "marketplace", "add", "C:\\Users\\Ana M\\Devi"], "win32")).toEqual([
    "cmd.exe", "/d", "/s", "/c", 'C:\\npm\\claude.cmd plugin marketplace add "C:\\Users\\Ana M\\Devi"',
  ]);
});

test("quoteCmdArg: % y ! escapados, vacío y espacios entrecomillados", () => {
  expect(quoteCmdArg("")).toBe('""');
  expect(quoteCmdArg("simple")).toBe("simple");
  expect(quoteCmdArg("100%")).toBe("100%%");
  expect(quoteCmdArg("%PATH%")).toBe("%%PATH%%");
  expect(quoteCmdArg("hola!")).toBe("hola^!");
  expect(quoteCmdArg("a b%")).toBe('"a b%%"');
  expect(quoteCmdArg('di "hola"')).toBe('"di ""hola"""');
  expect(quoteCmdArg("a&b")).toBe('"a&b"');
});

test("spawnArgv: argumentos vacíos y especiales en .cmd", () => {
  expect(spawnArgv("C:\\n\\claude.cmd", ["", "50%", "x!"], "win32")).toEqual([
    "cmd.exe", "/d", "/s", "/c", 'C:\\n\\claude.cmd "" 50%% x^!',
  ]);
});
