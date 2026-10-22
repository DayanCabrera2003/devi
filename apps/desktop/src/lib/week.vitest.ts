import { describe, expect, test } from "vitest";
import { durationText, isWeekDue, weekKey } from "./week";

// Fechas locales: el lunes es el de quien usa la app.
const at = (y: number, m: number, d: number, h = 10) => new Date(y, m - 1, d, h).getTime();

describe("weekKey", () => {
  test("semana ISO: lunes a domingo, con el año de su jueves", () => {
    expect(weekKey(at(2026, 10, 19))).toBe("2026-W43"); // lunes
    expect(weekKey(at(2026, 10, 25, 23))).toBe("2026-W43"); // domingo
    expect(weekKey(at(2026, 10, 26))).toBe("2026-W44");
    expect(weekKey(at(2027, 1, 1))).toBe("2026-W53"); // viernes 1 de enero: aún es la última de 2026
    expect(weekKey(at(2025, 12, 29))).toBe("2026-W01"); // lunes de la semana del 1 de enero de 2026
  });
});

describe("isWeekDue", () => {
  test("solo los lunes y mientras no se descarte esa semana", () => {
    expect(isWeekDue(at(2026, 10, 19))).toBe(true);
    expect(isWeekDue(at(2026, 10, 20))).toBe(false);
    expect(isWeekDue(at(2026, 10, 19), "2026-W43")).toBe(false);
    expect(isWeekDue(at(2026, 10, 26), "2026-W43")).toBe(true);
  });
});

describe("durationText", () => {
  test("segundos, minutos u horas", () => {
    expect(durationText(40_000)).toBe("40 s");
    expect(durationText(12 * 60_000)).toBe("12 min");
    expect(durationText(65 * 60_000)).toBe("1 h 5 min");
    expect(durationText(2 * 3_600_000)).toBe("2 h");
    expect(durationText(30 * 3_600_000)).toBe("1 d 6 h");
  });
});
