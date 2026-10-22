import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { SHUTDOWN_SIGNALS, onShutdown } from "./lifecycle";

function setup(work: () => Promise<void> = async () => {}) {
  const stdin = new EventEmitter();
  const proc = new EventEmitter();
  const reasons: string[] = [];
  const exits: number[] = [];
  onShutdown({ stdin, proc }, async (reason) => {
    reasons.push(reason);
    await work();
  }, (code) => void exits.push(code), 50);
  return { stdin, proc, reasons, exits };
}

test("al cerrarse stdin (Claude Code terminó) limpia una sola vez y sale con 0", async () => {
  const s = setup();
  s.stdin.emit("end");
  s.stdin.emit("close");
  s.proc.emit("SIGTERM");
  await Bun.sleep(5);
  expect(s.reasons).toEqual(["stdin"]);
  expect(s.exits).toEqual([0]);
});

test("también con SIGTERM, SIGINT y SIGHUP", async () => {
  expect(SHUTDOWN_SIGNALS).toEqual(["SIGTERM", "SIGINT", "SIGHUP"]);
  for (const sig of SHUTDOWN_SIGNALS) {
    const s = setup();
    s.proc.emit(sig);
    await Bun.sleep(5);
    expect(s.reasons).toEqual([sig]);
    expect(s.exits).toEqual([0]);
  }
});

test("si la limpieza se cuelga (servidor caído), sale igualmente tras el plazo", async () => {
  const s = setup(() => new Promise(() => {}));
  s.proc.emit("SIGTERM");
  await Bun.sleep(5);
  expect(s.exits).toEqual([]);
  await Bun.sleep(80);
  expect(s.exits).toEqual([0]);
});
