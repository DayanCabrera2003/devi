import { expect, test } from "bun:test";
import { VERSION_FILES, isVersion, setBunLockVersions, setCargoLockVersion, setCargoTomlVersion, setJsonVersions } from "./set-version";

test("valida X.Y.Z", () => {
  expect(isVersion("0.3.0")).toBe(true);
  expect(isVersion("10.20.30")).toBe(true);
  expect(isVersion("v0.3.0")).toBe(false);
  expect(isVersion("0.3")).toBe(false);
  expect(isVersion("0.3.0-beta")).toBe(false);
});

test("package.json: cambia solo la versión de primer nivel y conserva el formato", () => {
  const src = `{\n  "name": "x",\n  "version": "0.2.0",\n  "dependencies": {\n    "zod": "^4.6.5"\n  }\n}\n`;
  expect(setJsonVersions(src, "0.3.0", "top")).toBe(src.replace('"version": "0.2.0"', '"version": "0.3.0"'));
});

test("manifiesto del marketplace: cambia todas las versiones", () => {
  const src = `{\n  "name": "m",\n  "plugins": [\n    {\n      "name": "devi",\n      "version": "1.0.0"\n    }\n  ]\n}\n`;
  const out = setJsonVersions(src, "0.3.0", "all");
  expect(out).toContain('"version": "0.3.0"');
  expect(out).not.toContain("1.0.0");
});

test("JSON sin versión: error", () => {
  expect(() => setJsonVersions(`{ "name": "x" }`, "0.3.0", "top")).toThrow();
});

test("Cargo.toml: solo la versión de [package], no las de dependencias", () => {
  const src = `[package]\nname = "devi-desktop"\nversion = "0.2.0"\nedition = "2021"\n\n[dependencies]\nserde = { version = "1" }\n\n[dev]\nversion = "9.9.9"\n`;
  const out = setCargoTomlVersion(src, "0.3.0");
  expect(out).toContain('[package]\nname = "devi-desktop"\nversion = "0.3.0"\n');
  expect(out).toContain('version = "9.9.9"');
  expect(out).toContain('serde = { version = "1" }');
});

test("Cargo.toml sin [package]: error", () => {
  expect(() => setCargoTomlVersion(`[dependencies]\nversion = "1.0.0"\n`, "0.3.0")).toThrow();
});

test("Cargo.lock: solo la entrada del crate indicado", () => {
  const src = `[[package]]\nname = "devi"\nversion = "1.0.0"\n\n[[package]]\nname = "devi-desktop"\nversion = "0.2.0"\ndependencies = [\n "serde",\n]\n`;
  const out = setCargoLockVersion(src, "devi-desktop", "0.3.0");
  expect(out).toContain('name = "devi-desktop"\nversion = "0.3.0"\n');
  expect(out).toContain('name = "devi"\nversion = "1.0.0"\n');
});

test("Cargo.lock sin el crate: sin cambios", () => {
  const src = `[[package]]\nname = "otro"\nversion = "1.0.0"\n`;
  expect(setCargoLockVersion(src, "devi-desktop", "0.3.0")).toBe(src);
});

test("nunca toca el protocolo", () => {
  expect(VERSION_FILES.some((f) => f.path.includes("protocol"))).toBe(false);
});

test("bun.lock: solo los workspaces indicados", () => {
  const src = `{\n  "workspaces": {\n    "packages/cli": {\n      "name": "@devi/cli",\n      "version": "1.0.0",\n    },\n    "packages/protocol": {\n      "name": "@devi/protocol",\n      "version": "1.0.0",\n    },\n  },\n}\n`;
  const out = setBunLockVersions(src, ["@devi/cli"], "0.3.0");
  expect(out).toContain('"name": "@devi/cli",\n      "version": "0.3.0"');
  expect(out).toContain('"name": "@devi/protocol",\n      "version": "1.0.0"');
});
