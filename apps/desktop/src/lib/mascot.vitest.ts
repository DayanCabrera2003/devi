import { afterEach, describe, expect, test } from "vitest";
import css from "../styles.css?raw";
import { MASCOT_LABEL, markMascotDocument } from "./mascot";

describe("ventana de la mascota", () => {
  afterEach(() => {
    document.documentElement.classList.remove("mascota");
    document.body.classList.remove("mascota");
  });

  test("marca html y body para que la ventana no tenga fondo", () => {
    markMascotDocument(document);
    expect(document.documentElement.classList.contains("mascota")).toBe(true);
    expect(document.body.classList.contains("mascota")).toBe(true);
    expect(MASCOT_LABEL).toBe("mascota");
  });

  test("en la mascota html y body son transparentes", () => {
    expect(css).toMatch(/html\.mascota,\s*html\.mascota body\s*\{[^}]*background:\s*transparent/);
  });
});
