import { describe, expect, test } from "bun:test";
import { migrate, openDb } from "./db";

describe("migraciones", () => {
  test("aplica en orden y guarda la versión por módulo", () => {
    const db = openDb();
    const applied = migrate(db, "team", [
      { version: 1, sql: "CREATE TABLE members (id TEXT PRIMARY KEY)" },
      { version: 2, sql: "ALTER TABLE members ADD COLUMN name TEXT" },
    ]);
    expect(applied).toBe(2);
    db.run("INSERT INTO members (id, name) VALUES ('m1', 'María')");
    expect(db.query("SELECT name FROM members").get()).toEqual({ name: "María" });
  });

  test("es idempotente y solo aplica las nuevas", () => {
    const db = openDb();
    const m1 = { version: 1, sql: "CREATE TABLE t (a TEXT)" };
    expect(migrate(db, "x", [m1])).toBe(1);
    expect(migrate(db, "x", [m1])).toBe(0);
    expect(migrate(db, "x", [m1, { version: 2, sql: "ALTER TABLE t ADD COLUMN b TEXT" }])).toBe(1);
  });

  test("módulos independientes", () => {
    const db = openDb();
    migrate(db, "a", [{ version: 1, sql: "CREATE TABLE ta (x TEXT)" }]);
    expect(migrate(db, "b", [{ version: 1, sql: "CREATE TABLE tb (x TEXT)" }])).toBe(1);
  });

  test("una migración que falla no deja nada a medias", () => {
    const db = openDb();
    expect(() => migrate(db, "z", [{ version: 1, sql: "CREATE TABLE ok (a TEXT); SELECT * FROM no_existe;" }])).toThrow();
    expect(db.query("SELECT name FROM sqlite_master WHERE name = 'ok'").get()).toBeNull();
  });

  test("foreign keys activadas", () => {
    const db = openDb();
    expect(db.query("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
  });
});
