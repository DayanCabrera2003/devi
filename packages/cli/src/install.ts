import { chmod, copyFile, mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { MARKETPLACE_NAME, PLUGIN_ID } from "./paths";
import { pluginFiles, renderJson } from "./plugin";

// ¿Se está ejecutando el binario compilado (bun build --compile) y no `bun src/main.ts`?
export function isCompiledBinary(argv1: string | undefined): boolean {
  return !!argv1 && (argv1.startsWith("/$bunfs/") || /^[A-Z]:[\\/]~BUN[\\/]/i.test(argv1));
}

// Copia el binario a la ruta estable. Escribe primero a un temporal y lo renombra.
export async function installBinary(from: string, to: string, platform: NodeJS.Platform): Promise<"copied" | "same"> {
  if (resolve(from) === resolve(to)) return "same";
  await mkdir(dirname(to), { recursive: true });
  const tmp = `${to}.tmp-${process.pid}`;
  await copyFile(from, tmp);
  if (platform !== "win32") await chmod(tmp, 0o755);
  await rename(tmp, to);
  return "copied";
}

export async function writeMarketplace(dir: string, bin: string, version: string): Promise<string[]> {
  const written: string[] = [];
  for (const [rel, content] of Object.entries(pluginFiles(bin, version))) {
    const path = join(dir, rel);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, renderJson(content), "utf8");
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
