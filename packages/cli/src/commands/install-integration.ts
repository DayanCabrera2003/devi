import { claudeSteps, installBinary, isCompiledBinary, parseJsonList, writeMarketplace } from "../install";
import { marketplaceDir as defaultMarketplaceDir, binaryName, stableBinDir, type Sys } from "../paths";
import { run as defaultRun } from "../proc";
import { CLI_VERSION } from "../version";
import { join } from "node:path";

export type InstallStep = { step: string; ok: boolean; detail: string };
export type InstallReport = { ok: boolean; binPath: string; marketplaceDir: string; steps: InstallStep[]; error?: string };

// `devi install-integration`: lo llama la app de escritorio (sidecar) en el asistente.
// Con --json, la última línea de stdout es un InstallReport. Código de salida 0 si todo fue bien.
export async function runInstallIntegration(
  opts: { from: string | undefined; binDir: string | undefined; marketplaceDir: string | undefined; skipClaude: boolean; json: boolean },
  sys: Sys,
  deps: { run?: typeof defaultRun } = {},
): Promise<number> {
  const run = deps.run ?? defaultRun;
  const binPath = join(opts.binDir ?? stableBinDir(sys), binaryName(sys.platform));
  const mpDir = opts.marketplaceDir ?? defaultMarketplaceDir(sys);
  const report: InstallReport = { ok: true, binPath, marketplaceDir: mpDir, steps: [] };
  const step = (s: InstallStep) => {
    report.steps.push(s);
    if (!s.ok) report.ok = false;
    if (!opts.json) console.log(`${s.ok ? "✓" : "✗"} ${s.step}: ${s.detail}`);
  };

  const from = opts.from ?? (isCompiledBinary(process.argv[1]) ? process.execPath : null);
  if (!from) {
    step({ step: "binario", ok: false, detail: "ejecuta install-integration desde el binario compilado de devi, o pasa --from <ruta del binario>" });
  } else {
    try {
      const r = await installBinary(from, binPath, sys.platform);
      step({ step: "binario", ok: true, detail: r === "same" ? `ya estaba en ${binPath}` : `copiado a ${binPath}` });
    } catch (e) {
      step({ step: "binario", ok: false, detail: `no se pudo copiar a ${binPath}: ${(e as Error).message}` });
    }
  }

  if (report.ok) {
    try {
      await writeMarketplace(mpDir, binPath, CLI_VERSION);
      step({ step: "marketplace", ok: true, detail: `plugin escrito en ${mpDir}` });
    } catch (e) {
      step({ step: "marketplace", ok: false, detail: `no se pudo escribir ${mpDir}: ${(e as Error).message}` });
    }
  }

  if (report.ok && !opts.skipClaude) {
    try {
      await integrateWithClaude();
    } catch (e) {
      step({ step: "claude", ok: false, detail: `no se pudo ejecutar \`claude\`: ${(e as Error).message}` });
    }
  }

  if (!report.ok) report.error = report.steps.find((x) => !x.ok)?.detail ?? "falló la instalación";
  if (opts.json) console.log(JSON.stringify(report));
  else if (report.ok) console.log("Listo. Reinicia las sesiones de Claude Code abiertas para cargar el plugin.");
  return report.ok ? 0 : 1;

  async function integrateWithClaude() {
    const mps = await run("claude", ["plugin", "marketplace", "list", "--json"]);
    if (!mps) {
      step({ step: "claude", ok: false, detail: "no encuentro `claude` en el PATH; instala Claude Code y repite" });
    } else {
      const plugins = await run("claude", ["plugin", "list", "--json"]);
      const steps = claudeSteps({
        marketplaceDir: mpDir,
        marketplaces: parseJsonList<{ name: string }>(mps.stdout),
        plugins: parseJsonList<{ id: string }>(plugins?.stdout ?? "[]"),
      });
      for (const args of steps) {
        const r = await run("claude", args, { timeoutMs: 120_000 });
        const label = `claude ${args.join(" ")}`;
        if (r && r.code === 0) step({ step: label, ok: true, detail: "hecho" });
        else step({ step: label, ok: false, detail: (r?.stderr || r?.stdout || "falló").trim().slice(0, 500) });
        if (!report.ok) break;
      }
    }
  }
}
