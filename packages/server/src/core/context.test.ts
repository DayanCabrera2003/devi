import { expect, test } from "bun:test";
import { PRESENCE } from "@devi/protocol";
import { createApp } from "./app";
import { DevIdentity } from "./auth";
import { FakeClock } from "./clock";
import type { ModuleContext } from "./module";

test("ModuleContext trae timers, presence y services; start programa la revisión de presencia y stop la cancela", async () => {
  const clock = new FakeClock(0);
  let seen: ModuleContext | undefined;
  const app = createApp({
    identity: new DevIdentity(),
    allowedOrigins: [],
    now: clock.now,
    timers: clock,
    modules: [
      {
        name: "probe",
        migrations: [],
        routes(_r, ctx) {
          seen = ctx;
          ctx.services.provide("settings", {
            get: () => ({ requestTimeoutMs: 1, draftTtlMs: 1, fileRetentionDays: 1, fileMaxAgeDays: 1, allowedDomains: [], chatApproval: true }),
          });
        },
      },
    ],
  });
  expect(seen?.timers).toBe(clock);
  expect(seen?.services.get("settings").get().draftTtlMs).toBe(1);

  const changes: boolean[] = [];
  app.ctx.bus.on("presence.changed", (c) => changes.push(c.alive));
  app.ctx.presence.open("user:m1", new AbortController().signal); // stream que nadie cierra
  await app.start();
  expect(clock.pending()).toBe(1); // la revisión periódica
  clock.advance(PRESENCE.staleMs + PRESENCE.sweepMs);
  expect(changes).toEqual([true, false]); // la revisión la marcó caída sin latidos
  app.stop();
  expect(clock.pending()).toBe(0);
});
