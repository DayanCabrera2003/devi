#!/usr/bin/env bun
// Binario `devi`: server | mcp | hook | claude | doctor | install-integration.
import { CliArgError, USAGE, parseCliArgs } from "./args";
import { runClaude } from "./commands/claude";
import { runDoctor } from "./commands/doctor";
import { runHook } from "./commands/hook";
import { runInstallIntegration } from "./commands/install-integration";
import { runServer } from "./commands/server";
import { runMcp } from "./mcp/server";
import { currentSys } from "./paths";
import { CLI_VERSION } from "./version";

async function main(argv: string[]): Promise<number | null> {
  const sys = currentSys();
  const cmd = parseCliArgs(argv, sys.env);
  switch (cmd.cmd) {
    case "help":
      console.log(USAGE);
      return 0;
    case "version":
      console.log(CLI_VERSION);
      return 0;
    case "server":
      await runServer(cmd.argv);
      return null; // sigue vivo sirviendo
    case "mcp":
      await runMcp(sys);
      return null; // sigue vivo hasta que Claude Code cierre stdin
    case "hook":
      await runHook(cmd.status, sys);
      return 0;
    case "claude":
      return runClaude(cmd, sys);
    case "doctor":
      return runDoctor(sys);
    case "install-integration":
      return runInstallIntegration(cmd, sys);
  }
}

// Qué imprimir y qué código devolver cuando algo lanza. Con `install-integration --json`
// el contrato es una última línea JSON { ok:false, error, steps } y código 1, también ante errores de argumentos.
export function fatalOutput(argv: string[], e: unknown): { code: number; stdout?: string; stderr?: string } {
  const isArg = e instanceof CliArgError;
  const message = isArg ? e.message : `[devi] ${(e as Error).message}`;
  if (argv[0] === "hook") return { code: 0 };
  if (argv[0] === "install-integration" && argv.includes("--json")) {
    return { code: 1, stdout: JSON.stringify({ ok: false, error: isArg ? e.message : (e as Error).message, steps: [] }) };
  }
  return { code: isArg ? 2 : 1, stderr: message };
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  try {
    const code = await main(argv);
    if (code !== null) process.exit(code);
  } catch (e) {
    // `devi hook` nunca falla: ni siquiera con argumentos raros.
    const out = fatalOutput(argv, e);
    if (out.stdout !== undefined) console.log(out.stdout);
    if (out.stderr !== undefined) console.error(out.stderr);
    process.exit(out.code);
  }
}
