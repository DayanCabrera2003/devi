import { homedir } from "node:os";
import { startServer } from "@devi/server";
import { parseServerArgs } from "@devi/server/src/core/config";

// `devi server …`: mismo arranque que `bun packages/server/src/main.ts …`.
export async function runServer(argv: string[]): Promise<void> {
  const cfg = parseServerArgs(argv, { platform: process.platform, env: process.env, home: homedir() });
  await startServer(cfg);
}
