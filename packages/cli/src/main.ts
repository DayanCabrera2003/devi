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

if (import.meta.main) {
  const argv = process.argv.slice(2);
  try {
    const code = await main(argv);
    if (code !== null) process.exit(code);
  } catch (e) {
    // `devi hook` nunca falla: ni siquiera con argumentos raros.
    if (argv[0] === "hook") process.exit(0);
    console.error(e instanceof CliArgError ? e.message : `[devi] ${(e as Error).message}`);
    process.exit(e instanceof CliArgError ? 2 : 1);
  }
}
