import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { machineId, pairing } from "./pairing";

const sysIn = (home: string, env: Record<string, string> = {}) => ({ platform: "linux" as const, env, home });

test("machineId: DEVI_MACHINE_ID manda (tests, contenedores clonados)", () => {
  expect(machineId(sysIn("/no/existe", { DEVI_MACHINE_ID: "  maquina-1 " }))).toBe("maquina-1");
});

test("machineId: se crea una vez en la carpeta de datos de Devi y después se reutiliza", () => {
  const home = mkdtempSync(join(tmpdir(), "devi-machine-"));
  const first = machineId(sysIn(home));
  expect(first).toMatch(/^[0-9a-f-]{36}$/);
  const file = join(home, ".local", "share", "devi", "machine-id");
  expect(readFileSync(file, "utf8").trim()).toBe(first);
  expect(machineId(sysIn(home))).toBe(first);
  // Otro proceso (un hook) de la misma cuenta lee el mismo id.
  writeFileSync(file, "fijado-a-mano\n");
  expect(machineId(sysIn(home))).toBe("fijado-a-mano");
});

test("machineId: si no se puede escribir, cae al nombre del equipo (nunca lanza)", () => {
  expect(machineId(sysIn("/proc/no-se-puede"))).toBe(`host:${hostname()}`);
});

test("pairing: pid de Claude Code (el padre) y la máquina", () => {
  expect(pairing(sysIn("/x", { DEVI_MACHINE_ID: "M1" }))).toEqual({ parentPid: process.ppid, machine: "M1" });
});
