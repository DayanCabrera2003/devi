import { afterEach, describe, expect, test } from "vitest";
import { THEME_KEY, applyTheme, followStoredTheme, storedTheme } from "./theme";

describe("tema", () => {
  afterEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  test("Sistema quita la marca; Claro y Oscuro la fijan y se guardan para la mascota", () => {
    applyTheme("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(storedTheme()).toBe("dark");
    applyTheme("system");
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(localStorage.getItem(THEME_KEY)).toBe("system");
  });

  test("la ventana de la mascota sigue los cambios de la principal", () => {
    localStorage.setItem(THEME_KEY, "light");
    const stop = followStoredTheme();
    expect(document.documentElement.dataset.theme).toBe("light");
    window.dispatchEvent(new StorageEvent("storage", { key: THEME_KEY, newValue: "dark" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    stop();
  });

  test("un valor desconocido vuelve a Sistema", () => {
    localStorage.setItem(THEME_KEY, "morado");
    expect(storedTheme()).toBe("system");
  });
});
