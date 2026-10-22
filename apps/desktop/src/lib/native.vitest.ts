import { beforeEach, describe, expect, test, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
const listen = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/event", () => ({ listen }));

import { DEFAULT_PREFS, native, prefsOf, type PickResult } from "./native";

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

describe("archivos para adjuntar", () => {
  beforeEach(() => {
    invoke.mockReset();
    listen.mockReset();
  });

  const RESULT: PickResult = {
    files: [{ token: "t1", name: "log.txt", size: 4, preview: "boom" }],
    rejected: [{ name: "foto.png", reason: "no es un archivo de texto (tiene bytes NUL)" }],
  };

  test("pickFiles abre el diálogo en Rust, sin argumentos (el webview no elige rutas)", async () => {
    invoke.mockResolvedValue(RESULT);
    expect(await native.pickFiles()).toEqual(RESULT);
    expect(invoke).toHaveBeenLastCalledWith("pick_files");
  });

  test("takeFiles y discardFiles mandan los tokens", async () => {
    invoke.mockResolvedValue([{ name: "log.txt", content: "boom" }]);
    expect(await native.takeFiles(["t1", "t2"])).toEqual([{ name: "log.txt", content: "boom" }]);
    expect(invoke).toHaveBeenLastCalledWith("take_files", { tokens: ["t1", "t2"] });
    invoke.mockResolvedValue(undefined);
    await native.discardFiles(["t3"]);
    expect(invoke).toHaveBeenLastCalledWith("discard_files", { tokens: ["t3"] });
  });

  test("onFilesDropped y onDragHover escuchan los eventos de Rust y pasan solo el payload", async () => {
    const unlisten = vi.fn();
    listen.mockResolvedValue(unlisten);
    const dropped = vi.fn();
    const hover = vi.fn();
    expect(await native.onFilesDropped(dropped)).toBe(unlisten);
    expect(await native.onDragHover(hover)).toBe(unlisten);
    expect(listen.mock.calls.map((c) => c[0])).toEqual(["devi://files-dropped", "devi://drag-hover"]);
    listen.mock.calls[0]![1]({ event: "devi://files-dropped", id: 1, payload: RESULT });
    listen.mock.calls[1]![1]({ event: "devi://drag-hover", id: 2, payload: { active: true } });
    expect(dropped).toHaveBeenCalledWith(RESULT);
    expect(hover).toHaveBeenCalledWith({ active: true });
  });
});
