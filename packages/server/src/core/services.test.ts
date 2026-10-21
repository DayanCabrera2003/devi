import { expect, test } from "bun:test";
import { ServiceRegistry, type SettingsService } from "./services";

test("provide / get / find", () => {
  const reg = new ServiceRegistry();
  expect(reg.find("settings")).toBeUndefined();
  expect(() => reg.get("settings")).toThrow("servicio no registrado: settings");
  const s: SettingsService = {
    get: () => ({ requestTimeoutMs: 1, draftTtlMs: 1, fileRetentionDays: 1, fileMaxAgeDays: 1 }),
  };
  reg.provide("settings", s);
  expect(reg.get("settings")).toBe(s);
  expect(() => reg.provide("settings", s)).toThrow("servicio duplicado");
});
