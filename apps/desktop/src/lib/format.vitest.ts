import { describe, expect, test } from "vitest";
import { formatBytes, lastJsonLine, settingsFromForm, minutesToMs, msToMinutes, normalizeServerUrl, notWholeMinutes, truncate, waited } from "./format";

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

  test("sin redondear en silencio: decimales y aviso en segundos", () => {
    expect(msToMinutes(90_000)).toBe(1.5);
    expect(msToMinutes(100_000)).toBe(1.67);
    expect(notWholeMinutes(3_600_000)).toBeNull();
    expect(notWholeMinutes(90_500)).toBe("90,5 s");
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

describe("settingsFromForm (los rangos del servidor)", () => {
  const ok = { timeoutMin: 60, draftMin: 15, retentionDays: 7, maxAgeDays: 30 };

  test("convierte a milisegundos dentro de los rangos", () => {
    expect(settingsFromForm(ok)).toEqual({
      ok: true,
      settings: { requestTimeoutMs: 3_600_000, draftTtlMs: 900_000, fileRetentionDays: 7, fileMaxAgeDays: 30 },
    });
    expect(settingsFromForm({ timeoutMin: 10_080, draftMin: 1_440, retentionDays: 30, maxAgeDays: 30 }).ok).toBe(true);
    expect(settingsFromForm({ timeoutMin: 1, draftMin: 1, retentionDays: 1, maxAgeDays: 1 }).ok).toBe(true);
  });

  test("fuera de rango, vacío o con decimales: error por campo", () => {
    const r = settingsFromForm({ timeoutMin: 10_081, draftMin: 0, retentionDays: 31, maxAgeDays: Number.NaN });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(Object.keys(r.errors).sort()).toEqual(["draftMin", "maxAgeDays", "retentionDays", "timeoutMin"]);
    expect(r.errors.timeoutMin).toContain("7 días");
    expect(settingsFromForm({ ...ok, draftMin: 1_441 }).ok).toBe(false);
    expect(settingsFromForm({ ...ok, retentionDays: 1.5 }).ok).toBe(false);
    expect(settingsFromForm({ ...ok, timeoutMin: null as unknown as number }).ok).toBe(false);
  });

  test("el tope absoluto no puede ser menor que la retención", () => {
    const r = settingsFromForm({ ...ok, retentionDays: 10, maxAgeDays: 5 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.maxAgeDays).toContain("retención");
  });
});

describe("settingsFromForm con los valores iniciales", () => {
  const initial = { timeoutMin: 1.51, draftMin: 15, retentionDays: 7, maxAgeDays: 30 };

  test("solo envía los campos cambiados y no valida los que no se tocaron", () => {
    expect(settingsFromForm({ ...initial, draftMin: 20 }, initial)).toEqual({ ok: true, settings: { draftTtlMs: 1_200_000 } });
    expect(settingsFromForm(initial, initial)).toEqual({ ok: true, settings: {} });
  });

  test("un campo cambiado sigue validándose, también contra el otro sin cambiar", () => {
    expect(settingsFromForm({ ...initial, timeoutMin: 2.5 }, initial).ok).toBe(false);
    const r = settingsFromForm({ ...initial, maxAgeDays: 5 }, initial);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.maxAgeDays).toContain("retención");
  });
});
