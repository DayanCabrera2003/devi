import { svelte } from "@sveltejs/vite-plugin-svelte";
import { svelteTesting } from "@testing-library/svelte/vite";
import { defineConfig } from "vitest/config";

// Los tests se llaman *.vitest.ts para que el `bun test` de la raíz no los ejecute.
export default defineConfig({
  plugins: [svelte(), svelteTesting()],
  test: {
    environment: "jsdom",
    include: ["src/**/*.vitest.ts"],
    maxWorkers: 2,
    passWithNoTests: true,
  },
});
