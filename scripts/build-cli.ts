// Compila el binario `devi` para los 5 targets, uno detrás de otro (cada binario ocupa ~90 MB
// y la compilación cruzada descarga el runtime de Bun de cada target: en paralelo se dispara la RAM).
// Salida: dist/bin/devi-<target>[.exe] y la copia con nombre de sidecar de Tauri devi-<rust-triple>[.exe].
// Uso: bun scripts/build-cli.ts [--only <target>]... [--current]
import { copyFileSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";

export const TARGETS = [
  { bun: "bun-windows-x64", rust: "x86_64-pc-windows-msvc", exe: true },
  { bun: "bun-darwin-arm64", rust: "aarch64-apple-darwin", exe: false },
  { bun: "bun-darwin-x64", rust: "x86_64-apple-darwin", exe: false },
  { bun: "bun-linux-x64", rust: "x86_64-unknown-linux-gnu", exe: false },
  { bun: "bun-linux-arm64", rust: "aarch64-unknown-linux-gnu", exe: false },
] as const;
export type Target = (typeof TARGETS)[number];

const ROOT = join(import.meta.dir, "..");
const ENTRY = join(ROOT, "packages/cli/src/main.ts");
const OUT = join(ROOT, "dist/bin");

export function outputNames(t: Target): { binary: string; sidecar: string } {
  const ext = t.exe ? ".exe" : "";
  return { binary: `devi-${t.bun}${ext}`, sidecar: `devi-${t.rust}${ext}` };
}

export function currentTarget(platform = process.platform, arch = process.arch): Target {
  const os = platform === "win32" ? "windows" : platform;
  const t = TARGETS.find((x) => x.bun === `bun-${os}-${arch}`);
  if (!t) throw new Error(`plataforma sin target: ${platform}-${arch}`);
  return t;
}

export function selectTargets(argv: string[]): Target[] {
  const picked: Target[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--current") picked.push(currentTarget());
    else if (a === "--only") {
      const name = argv[++i];
      const t = TARGETS.find((x) => x.bun === name);
      if (!t) throw new Error(`target desconocido: ${name} (válidos: ${TARGETS.map((x) => x.bun).join(", ")})`);
      picked.push(t);
    } else throw new Error(`argumento desconocido: ${a}`);
  }
  return picked.length > 0 ? picked : [...TARGETS];
}

async function build(t: Target): Promise<void> {
  const { binary, sidecar } = outputNames(t);
  const out = join(OUT, binary);
  const proc = Bun.spawn(
    [process.execPath, "build", "--compile", "--minify", `--target=${t.bun}`, `--outfile=${out}`, ENTRY],
    { cwd: ROOT, stdout: "inherit", stderr: "inherit" },
  );
  if ((await proc.exited) !== 0) throw new Error(`falló la compilación de ${t.bun}`);
  copyFileSync(out, join(OUT, sidecar));
  console.log(`✓ ${binary} (${Math.round(statSync(out).size / 1e6)} MB) + ${sidecar}`);
}

if (import.meta.main) {
  try {
    mkdirSync(OUT, { recursive: true });
    for (const t of selectTargets(process.argv.slice(2))) await build(t); // secuencial a propósito
  } catch (e) {
    console.error(`[build-cli] ${(e as Error).message}`);
    process.exit(1);
  }
}
