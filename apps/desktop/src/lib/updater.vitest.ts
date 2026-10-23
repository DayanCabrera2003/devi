import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn() }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));

import { UPDATE_CHECK_EVERY_MS, watchUpdates } from "./updater";

type Found = { version: string };
const v = (version: string) => ({ version }) as Found;

describe("watchUpdates", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test("busca al empezar y luego cada intervalo", async () => {
    const find = vi.fn(async () => null);
    const stop = watchUpdates({ find, onFound: vi.fn() });
    await vi.advanceTimersByTimeAsync(0);
    expect(find).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_EVERY_MS);
    expect(find).toHaveBeenCalledTimes(2);
    stop();
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_EVERY_MS * 3);
    expect(find).toHaveBeenCalledTimes(2);
  });

  test("avisa una vez por versión: la misma versión no repite y una más nueva sí", async () => {
    const results = [v("0.7.0"), v("0.7.0"), v("0.8.0")];
    const find = vi.fn(async () => results.shift() ?? null);
    const onFound = vi.fn();
    const stop = watchUpdates({ find, onFound });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_EVERY_MS);
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_EVERY_MS);
    expect(onFound.mock.calls.map(([u]) => (u as Found).version)).toEqual(["0.7.0", "0.8.0"]);
    stop();
  });
});
