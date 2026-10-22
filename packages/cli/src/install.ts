import { chmod, copyFile, mkdir, readdir, rename as fsRename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { MARKETPLACE_NAME, PLUGIN_ID } from "./paths";
import { pluginFiles, renderFile } from "./plugin";

// ¿Se está ejecutando el binario compilado (bun build --compile) y no `bun src/main.ts`?
export function isCompiledBinary(argv1: string | undefined): boolean {
  return !!argv1 && (argv1.startsWith("/$bunfs/") || /^[A-Z]:[\\/]~BUN[\\/]/i.test(argv1));
}

// Copia el binario a la ruta estable. Escribe primero a un temporal y lo renombra.
// En Windows no se puede reemplazar un .exe en uso (EPERM/EBUSY), pero sí renombrarlo: se aparta
// el viejo a `<nombre>.old-<timestamp>` y se coloca el nuevo.
export async function installBinary(
  from: string,
  to: string,
  platform: NodeJS.Platform,
  fs: { rename?: (a: string, b: string) => Promise<void> } = {},
): Promise<"copied" | "same"> {
  const rename = fs.rename ?? fsRename;
  if (resolve(from) === resolve(to)) return "same";
  await mkdir(dirname(to), { recursive: true });
  const tmp = `${to}.tmp-${process.pid}`;
  await copyFile(from, tmp);
  if (platform !== "win32") await chmod(tmp, 0o755);
  try {
    await rename(tmp, to);
    return "copied";
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (platform !== "win32" || (code !== "EPERM" && code !== "EBUSY")) {
      await rm(tmp, { force: true });
      throw e;
    }
  }
  const aside = `${to}.old-${Date.now()}`;
  try {
    await rename(to, aside);
    await rename(tmp, to);
  } catch {
    await rm(tmp, { force: true });
    throw new Error("Cierra tus sesiones de Claude Code con Devi y vuelve a intentarlo");
  }
  await removeOldBinaries(to, aside);
  return "copied";
}

// Mejor esfuerzo: borra `<nombre>.old-*` anteriores (los que sigan en uso fallan y se ignoran).
async function removeOldBinaries(to: string, keep: string): Promise<void> {
  try {
    const prefix = `${basename(to)}.old-`;
    for (const f of await readdir(dirname(to))) {
      const full = join(dirname(to), f);
      if (f.startsWith(prefix) && full !== keep) await rm(full, { force: true }).catch(() => {});
    }
  } catch {
    // no pasa nada
  }
}

export async function writeMarketplace(dir: string, bin: string, version: string): Promise<string[]> {
  const written: string[] = [];
  for (const [rel, content] of Object.entries(pluginFiles(bin, version))) {
    const path = join(dir, rel);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, renderFile(content), "utf8");
    written.push(path);
  }
  return written;
}

// Pasos `claude plugin …` idempotentes, según lo que ya está dado de alta.
export function claudeSteps(opts: {
  marketplaceDir: string;
  marketplaces: { name: string }[];
  plugins: { id: string }[];
}): string[][] {
  const steps: string[][] = [];
  if (opts.marketplaces.some((m) => m.name === MARKETPLACE_NAME)) steps.push(["plugin", "marketplace", "update", MARKETPLACE_NAME]);
  else steps.push(["plugin", "marketplace", "add", opts.marketplaceDir]);
  if (opts.plugins.some((p) => p.id === PLUGIN_ID)) steps.push(["plugin", "update", PLUGIN_ID, "--scope", "user"]);
  else steps.push(["plugin", "install", PLUGIN_ID, "--scope", "user"]);
  return steps;
}

export function parseJsonList<T>(text: string): T[] {
  try {
    const v: unknown = JSON.parse(text);
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}
