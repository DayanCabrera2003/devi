import { relaunch } from "@tauri-apps/plugin-process";
import { type Update, check } from "@tauri-apps/plugin-updater";

// La app suele pasar días abierta en la bandeja: buscar solo al arrancar no basta.
export const UPDATE_CHECK_EVERY_MS = 6 * 3_600_000;

// Devuelve null si no hay versión nueva o si el updater no está disponible (dev, sin red…).
export async function findUpdate(): Promise<Update | null> {
  try {
    return await check();
  } catch (e) {
    console.warn("[devi] no se pudo buscar actualizaciones", e);
    return null;
  }
}

type Found = { version: string };
type WatchOpts<U extends Found> = { find: () => Promise<U | null>; onFound: (u: U) => void };

// Busca ya y luego cada UPDATE_CHECK_EVERY_MS; avisa una sola vez por versión. Devuelve cómo pararlo.
export function watchUpdates<U extends Found>({ find, onFound }: WatchOpts<U>): () => void {
  let last: string | null = null;
  const run = async () => {
    const u = await find();
    if (!u || u.version === last) return;
    last = u.version;
    onFound(u);
  };
  const first = setTimeout(() => void run(), 0);
  const every = setInterval(() => void run(), UPDATE_CHECK_EVERY_MS);
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
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
