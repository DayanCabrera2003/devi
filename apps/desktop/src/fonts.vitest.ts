import { describe, expect, test } from "vitest";
import main from "./main.ts?raw";
import css from "./styles.css?raw";

// Las dos ventanas (main y mascota) arrancan desde main.ts, así que las fuentes se importan ahí.

describe("fuentes empaquetadas", () => {
  test("main.ts importa Inter y JetBrains Mono antes de styles.css", () => {
    const inter = main.indexOf('import "@fontsource-variable/inter"');
    const mono = main.indexOf('import "@fontsource-variable/jetbrains-mono"');
    const styles = main.indexOf('import "./styles.css"');
    expect(inter).toBeGreaterThan(-1);
    expect(mono).toBeGreaterThan(-1);
    expect(inter).toBeLessThan(styles);
    expect(mono).toBeLessThan(styles);
  });

  test("las variables apuntan a las fuentes empaquetadas y nada se carga de una CDN", () => {
    expect(css).toMatch(/--sans:\s*"Inter Variable"/);
    expect(css).toMatch(/--mono:\s*"JetBrains Mono Variable"/);
    expect(css).not.toMatch(/@import|url\(["']?https?:/);
  });
});
