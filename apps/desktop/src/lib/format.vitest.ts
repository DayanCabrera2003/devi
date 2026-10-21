import { describe, expect, test } from "vitest";
import { formatBytes, lastJsonLine, minutesToMs, msToMinutes, normalizeServerUrl, truncate, waited } from "./format";

describe("format", () => {
  test("formatBytes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(1_572_864)).toBe("1.5 MB");
  });

  test("waited", () => {
    expect(waited({ sentAt: 0, deadline: 3_600_000 })).toBe("1 h");
    expect(waited({ sentAt: 0, deadline: 300_000 })).toBe("5 min");
    expect(waited({ sentAt: 0, deadline: 20_000 })).toBe("20 s");
  });

  test("truncate", () => {
    expect(truncate("hola", 10)).toBe("hola");
    expect(truncate("abcdefghij", 5)).toBe("abcd…");
  });

  test("normalizeServerUrl acepta https de Tailscale y loopback en dev", () => {
    expect(normalizeServerUrl(" https://pc.tail1.ts.net/ ")).toEqual({ ok: true, url: "https://pc.tail1.ts.net" });
    expect(normalizeServerUrl("http://127.0.0.1:4747")).toEqual({ ok: true, url: "http://127.0.0.1:4747" });
    expect(normalizeServerUrl("http://[::1]:4747")).toEqual({ ok: true, url: "http://[::1]:4747" });
    expect(normalizeServerUrl("http://pc.tail1.ts.net").ok).toBe(false);
    expect(normalizeServerUrl("https://ejemplo.com").ok).toBe(false);
    expect(normalizeServerUrl("pc").ok).toBe(false);
  });

  test("minutos y milisegundos", () => {
    expect(msToMinutes(3_600_000)).toBe(60);
    expect(minutesToMs(15)).toBe(900_000);
  });
});

describe("lastJsonLine", () => {
  test("lee la última línea JSON de stdout", () => {
    const out = 'Copiando binario…\nInstalando plugin…\n{"ok":true,"binPath":"/h/.local/share/devi/bin/devi","marketplaceDir":"/m","steps":["bin","plugin"]}\n';
    expect(lastJsonLine<{ ok: boolean; binPath: string }>(out)).toMatchObject({ ok: true, binPath: "/h/.local/share/devi/bin/devi" });
  });
  test("sin JSON → null", () => {
    expect(lastJsonLine("hola\n")).toBeNull();
    expect(lastJsonLine("")).toBeNull();
    expect(lastJsonLine("{roto")).toBeNull();
  });
});
