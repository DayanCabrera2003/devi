import { expect, test } from "bun:test";
import { spawnArgv } from "./proc";

test("spawnArgv: directo salvo .cmd en Windows", () => {
  expect(spawnArgv("/usr/bin/claude", ["--name", "a b"], "linux")).toEqual(["/usr/bin/claude", "--name", "a b"]);
  expect(spawnArgv("C:\\x\\claude.exe", ["a"], "win32")).toEqual(["C:\\x\\claude.exe", "a"]);
  expect(spawnArgv("C:\\npm\\claude.cmd", ["plugin", "marketplace", "add", "C:\\Users\\Ana M\\Devi"], "win32")).toEqual([
    "cmd.exe", "/d", "/s", "/c", 'C:\\npm\\claude.cmd plugin marketplace add "C:\\Users\\Ana M\\Devi"',
  ]);
});
