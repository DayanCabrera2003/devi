import { render } from "@testing-library/svelte";
import { describe, expect, test } from "vitest";
import Devi from "./Devi.svelte";
import source from "./Devi.svelte?raw";

describe("Devi", () => {
  test("gris sin conexión", () => {
    const { getByRole } = render(Devi, { offline: true });
    expect(getByRole("img").classList.contains("offline")).toBe(true);
  });

  test("mira hacia abajo con pendientes y rebota al recibir algo", () => {
    const { getByRole } = render(Devi, { looking: true, pokeKey: 2 });
    const svg = getByRole("img");
    expect(svg.classList.contains("look")).toBe(true);
    expect(svg.classList.contains("bounce")).toBe(true);
  });

  test("en reposo no rebota ni mira abajo", () => {
    const { getByRole } = render(Devi, {});
    const svg = getByRole("img");
    expect(svg.classList.contains("bounce")).toBe(false);
    expect(svg.classList.contains("look")).toBe(false);
  });

  test("sin mood, el humor sale de offline y looking (compatibilidad)", () => {
    expect(render(Devi, { offline: true }).getByRole("img").dataset.mood).toBe("offline");
    expect(render(Devi, { looking: true }).getAllByRole("img").at(-1)!.dataset.mood).toBe("attentive");
    expect(render(Devi, {}).getAllByRole("img").at(-1)!.dataset.mood).toBe("calm");
  });

  test("dormida: ojos cerrados y «z z»", () => {
    const { getByRole, container } = render(Devi, { mood: "sleeping" });
    expect(getByRole("img").dataset.mood).toBe("sleeping");
    expect(getByRole("img").getAttribute("aria-label")).toBe("Devi (dormida)");
    expect(container.querySelector(".eyes.closed")).not.toBeNull();
    expect(container.querySelector(".zz")?.textContent?.replace(/\s+/g, "")).toBe("zz");
  });

  test("inquieta: tiembla y suda", () => {
    const { getByRole, container } = render(Devi, { mood: "uneasy" });
    expect(getByRole("img").classList.contains("uneasy")).toBe(true);
    expect(container.querySelector(".sweat")).not.toBeNull();
  });

  test("contenta: ojos ^ ^", () => {
    const { container } = render(Devi, { mood: "happy" });
    expect(container.querySelector(".eyes.happy")).not.toBeNull();
    expect(container.querySelector(".sweat")).toBeNull();
    expect(container.querySelector(".zz")).toBeNull();
  });

  test("atenta mira hacia abajo como looking", () => {
    expect(render(Devi, { mood: "attentive" }).getByRole("img").classList.contains("look")).toBe(true);
  });

  test("sin conexión gana a cualquier humor", () => {
    const svg = render(Devi, { offline: true, mood: "happy" }).getByRole("img");
    expect(svg.dataset.mood).toBe("offline");
    expect(svg.classList.contains("offline")).toBe(true);
  });

  test("respeta prefers-reduced-motion y usa las variables del tema", () => {
    expect(source).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    expect(source).toContain("var(--devi-eye)");
    expect(source).not.toMatch(/fill="#|stroke="#/);
  });
});
