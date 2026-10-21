import { fireEvent, render } from "@testing-library/svelte";
import { describe, expect, test, vi } from "vitest";
import { fakeApp } from "../../lib/test-app";
import LocalServerPanel from "./LocalServerPanel.svelte";

const RUNNING = { running: true, pid: 42, exitCode: null, log: ["escuchando en 127.0.0.1:4747"] };
const STOPPED = { running: false, pid: null, exitCode: 0, log: [] };

async function setup(opts: { status?: typeof RUNNING; serveOk?: boolean } = {}) {
  const native = {
    serverStatus: vi.fn(async () => opts.status ?? RUNNING),
    tailscaleServeConfigured: vi.fn(async () => opts.serveOk ?? true),
    startServer: vi.fn(async () => RUNNING),
    stopServer: vi.fn(async () => STOPPED),
    writeConfig: vi.fn(async () => {}),
  };
  const t = await fakeApp({}, native);
  t.app.config = { serverUrl: "https://pc.t.ts.net", app: { notifications: true, setupDone: true, serverAdminLogin: "dayan@x" } };
  const view = render(LocalServerPanel, { context: t.context });
  return { ...t, ...view, native };
}

describe("LocalServerPanel", () => {
  test("muestra el estado, el admin inicial y el log", async () => {
    const v = await setup();
    expect(await v.findByText(/Servidor en marcha \(PID 42\)/)).toBeTruthy();
    expect(v.getByText("dayan@x")).toBeTruthy();
    expect(v.getByText(/escuchando en 127.0.0.1:4747/)).toBeTruthy();
    expect(v.queryByText("tailscale serve --bg 4747")).toBeNull();
  });

  test("sin tailscale serve muestra la pista", async () => {
    const v = await setup({ serveOk: false });
    expect(await v.findByText("tailscale serve --bg 4747")).toBeTruthy();
  });

  test("detener y arrancar", async () => {
    const v = await setup();
    await fireEvent.click(await v.findByRole("button", { name: "Detener" }));
    expect(v.native.stopServer).toHaveBeenCalled();
    expect(await v.findByText(/Servidor detenido \(código 0\)/)).toBeTruthy();
    await fireEvent.click(v.getByRole("button", { name: "Arrancar" }));
    expect(v.native.startServer).toHaveBeenCalledWith("dayan@x");
  });

  test("dejar de ser el servidor pide confirmación, lo detiene y borra serverAdminLogin", async () => {
    const v = await setup();
    await fireEvent.click(await v.findByRole("button", { name: "Dejar de ser el servidor" }));
    expect(v.native.stopServer).not.toHaveBeenCalled();
    await fireEvent.click(v.getByRole("button", { name: "Sí, dejar de serlo" }));
    await vi.waitFor(() => expect(v.app.prefs.serverAdminLogin).toBeUndefined());
    expect(v.native.stopServer).toHaveBeenCalled();
  });
});
