import { describe, expect, test } from "bun:test";
import { API } from "./api";
import { WEEK_TOP, WeekSchema } from "./week";

describe("tu semana", () => {
  test("GET /me/week: lectura de cualquier miembro, no humana", () => {
    expect(API.myWeek).toMatchObject({ method: "GET", path: "/api/v1/me/week", perm: null, actor: "any" });
    expect("human" in API.myWeek).toBe(false);
  });

  test("valida el resumen y acota las personas", () => {
    const week = { from: 0, to: 1, sent: 2, received: 1, answered: 1, avgResponseMs: 60_000, topHelped: [{ memberId: "m1", count: 1 }] };
    expect(WeekSchema.parse(week)).toEqual(week);
    expect(WeekSchema.safeParse({ ...week, avgResponseMs: null }).success).toBe(true);
    const many = Array.from({ length: WEEK_TOP + 1 }, (_, i) => ({ memberId: `m${i}`, count: 1 }));
    expect(WeekSchema.safeParse({ ...week, topHelped: many }).success).toBe(false);
  });
});
