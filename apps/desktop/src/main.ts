import { mount } from "svelte";
import App from "./App.svelte";
// Fuentes empaquetadas: la UI se ve igual en WebView2, WKWebView y WebKitGTK (sin fuentes del sistema).
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "./styles.css";
import { applyTheme, storedTheme } from "./lib/theme";

const target = document.getElementById("app");
if (!target) throw new Error("falta #app en index.html");

// Último tema elegido antes del primer pintado (las prefs llegan después desde Rust).
applyTheme(storedTheme());

async function start(el: HTMLElement): Promise<void> {
  // Modo demo (?demo=<pantalla>): solo con `vite` en desarrollo; en el build de producción
  // import.meta.env.DEV es false y este bloque y sus datos de ejemplo desaparecen.
  if (import.meta.env.DEV) {
    const screen = new URLSearchParams(location.search).get("demo");
    if (screen !== null) {
      const { mountDemo } = await import("./demo/mount");
      await mountDemo(el, screen);
      return;
    }
  }
  mount(App, { target: el });
}

void start(target);
