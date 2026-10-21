import { relaunch } from "@tauri-apps/plugin-process";
import { type Update, check } from "@tauri-apps/plugin-updater";

// Devuelve null si no hay versión nueva o si el updater no está disponible (dev, sin red…).
export async function findUpdate(): Promise<Update | null> {
  try {
    return await check();
  } catch (e) {
    console.warn("[devi] no se pudo buscar actualizaciones", e);
    return null;
  }
}

export async function installAndRestart(update: Update, onProgress?: (pct: number) => void): Promise<void> {
  let total = 0;
  let done = 0;
  await update.downloadAndInstall((ev) => {
    if (ev.event === "Started") total = ev.data.contentLength ?? 0;
    else if (ev.event === "Progress") {
      done += ev.data.chunkLength;
      if (total > 0) onProgress?.(Math.min(100, Math.round((done * 100) / total)));
    }
  });
  await relaunch();
}
