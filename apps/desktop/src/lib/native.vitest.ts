import { beforeEach, describe, expect, test, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { DEFAULT_PREFS, native, prefsOf } from "./native";

describe("native", () => {
  beforeEach(() => invoke.mockReset());

  test("los argumentos van en camelCase, como espera Tauri", async () => {
    invoke.mockResolvedValue(["/r/q1/log.txt"]);
    const paths = await native.saveReceivedFiles("q1", "response", [{ name: "log.txt", content: "x" }]);
    expect(paths).toEqual(["/r/q1/log.txt"]);
    expect(invoke).toHaveBeenCalledWith("save_received_files", {
      requestId: "q1",
      kind: "response",
      files: [{ name: "log.txt", content: "x" }],
    });
  });

  test("start_server recibe adminLogin y la exportación va como bytes crudos", async () => {
    invoke.mockResolvedValue(undefined);
    await native.startServer("dayan@x");
    expect(invoke).toHaveBeenLastCalledWith("start_server", { adminLogin: "dayan@x" });
    const bytes = new Uint8Array([1, 2]);
    await native.saveDbExport(bytes);
    expect(invoke).toHaveBeenLastCalledWith("save_db_export", bytes);
  });

  test("quitApp llama a quit_app sin argumentos", async () => {
    invoke.mockResolvedValue(undefined);
    await native.quitApp();
    expect(invoke).toHaveBeenLastCalledWith("quit_app");
  });

  test("prefsOf completa con los valores por defecto", () => {
    expect(prefsOf(null)).toEqual(DEFAULT_PREFS);
    expect(prefsOf({ serverUrl: "x", app: { notifications: false, setupDone: true } })).toEqual({
      notifications: false,
      setupDone: true,
    });
  });
});
