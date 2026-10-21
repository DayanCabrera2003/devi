import { emitTo } from "@tauri-apps/api/event";
import { createDeviApi } from "./api";
import { DeviApp } from "./app.svelte";
import { MASCOT_EVENT } from "./mascot";
import { native } from "./native";
import { sendNative } from "./notify";

// DeviApp con las dependencias reales de Tauri (los tests usan dobles).
export function createApp(): DeviApp {
  return new DeviApp({
    native,
    makeApi: createDeviApi,
    notify: (n) => sendNative(n).catch((e) => console.warn("[devi] notificación", e)),
    emitMascot: (s) => {
      void emitTo("mascota", MASCOT_EVENT, s).catch(() => {});
    },
  });
}
