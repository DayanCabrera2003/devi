import { describe, expect, test } from "bun:test";
import { API_VERSION, VERSION_HEADER, VERSION_QUERY, isCompatible } from "./version";

describe("isCompatible", () => {
  test("acepta la misma versión mayor", () => {
    expect(isCompatible("1.0.0")).toBe(true);
    expect(isCompatible("1.7.3")).toBe(true);
  });
  test("rechaza otra versión mayor, vacía o mal formada", () => {
    expect(isCompatible("2.0.0")).toBe(false);
    expect(isCompatible("0.9.0")).toBe(false);
    expect(isCompatible("")).toBe(false);
    expect(isCompatible("abc")).toBe(false);
    expect(isCompatible(null)).toBe(false);
  });
  test("constantes", () => {
    expect(API_VERSION).toBe("1.0.0");
    expect(VERSION_HEADER).toBe("X-Devi-Version");
    expect(VERSION_QUERY).toBe("v");
  });
});
