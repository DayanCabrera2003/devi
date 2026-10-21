import { mount } from "svelte";
import App from "./App.svelte";
// Fuentes empaquetadas: la UI se ve igual en WebView2, WKWebView y WebKitGTK (sin fuentes del sistema).
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "./styles.css";

const target = document.getElementById("app");
if (!target) throw new Error("falta #app en index.html");

export default mount(App, { target });
