import { render } from "@testing-library/svelte";
import { describe, expect, test } from "vitest";
import Devi from "./Devi.svelte";

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
});
