import { expect, test } from "bun:test";
import { TARGETS, currentTarget, outputNames, selectTargets } from "./build-cli";

test("nombres de salida y de sidecar", () => {
  expect(TARGETS.map((t) => outputNames(t))).toEqual([
    { binary: "devi-bun-windows-x64.exe", sidecar: "devi-x86_64-pc-windows-msvc.exe" },
    { binary: "devi-bun-darwin-arm64", sidecar: "devi-aarch64-apple-darwin" },
    { binary: "devi-bun-darwin-x64", sidecar: "devi-x86_64-apple-darwin" },
    { binary: "devi-bun-linux-x64", sidecar: "devi-x86_64-unknown-linux-gnu" },
    { binary: "devi-bun-linux-arm64", sidecar: "devi-aarch64-unknown-linux-gnu" },
  ]);
});

test("selección de targets", () => {
  expect(selectTargets([]).length).toBe(5);
  expect(selectTargets(["--only", "bun-linux-arm64"]).map((t) => t.bun)).toEqual(["bun-linux-arm64"]);
  expect(currentTarget("win32", "x64").bun).toBe("bun-windows-x64");
  expect(currentTarget("darwin", "arm64").rust).toBe("aarch64-apple-darwin");
  expect(() => selectTargets(["--only", "bun-freebsd-x64"])).toThrow(/target desconocido/);
});
