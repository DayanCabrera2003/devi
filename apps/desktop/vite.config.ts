import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

// Configuración recomendada para Tauri. El puerto 1420 es fijo: el servidor de Devi en modo dev
// solo acepta el origen http://localhost:1420 (cualquier otro recibe 403 code "origin").
export default defineConfig({
  plugins: [svelte()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: {
    target: "es2022",
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
});
