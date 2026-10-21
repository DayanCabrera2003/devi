import { fireEvent, render } from "@testing-library/svelte";
import { describe, expect, test, vi } from "vitest";
import { fakeApp } from "../../lib/test-app";
import StepServer from "./StepServer.svelte";

const SELF = { login: "dayan@x", dnsName: "pc.t.ts.net" };
const RUNNING = { running: true, pid: 42, exitCode: null, log: [] };
const STOPPED = { running: false, pid: null, exitCode: 0, log: [] };

async function setup(opts: { serveOk?: boolean | Error; serverMode?: boolean } = {}) {
  const native = {
    startServer: vi.fn(async () => RUNNING),
    stopServer: vi.fn(async () => STOPPED),
    tailscaleServeConfigured: vi.fn(async () => {
      if (opts.serveOk instanceof Error) throw opts.serveOk;
      return opts.serveOk ?? true;
    }),
  };
  const t = await fakeApp({}, native);
  const onNext = vi.fn();
  const onBack = vi.fn();
  const view = render(StepServer, {
    context: t.context,
    props: { self: SELF, initialUrl: "", initialServerMode: opts.serverMode ?? true, onNext, onBack },
  });
  return { ...t, ...view, native, onNext, onBack };
}

async function start(v: Awaited<ReturnType<typeof setup>>) {
  await fireEvent.click(v.getByRole("checkbox", { name: "Sí, soy yo" }));
  await fireEvent.click(v.getByRole("button", { name: "Arrancar el servidor" }));
  await v.findByText(/Servidor en marcha/);
}

describe("StepServer", () => {
  test("no arranca el servidor con --admin hasta confirmar que el login es mío", async () => {
    const v = await setup();
    const arrancar = v.getByRole("button", { name: "Arrancar el servidor" }) as HTMLButtonElement;
    expect(arrancar.disabled).toBe(true);
    await fireEvent.click(arrancar);
    expect(v.native.startServer).not.toHaveBeenCalled();
    await start(v);
    expect(v.native.startServer).toHaveBeenCalledWith("dayan@x");
    expect(v.native.tailscaleServeConfigured).toHaveBeenCalled();
  });

  test("publicado en la tailnet: continúa con la URL https y el login admin", async () => {
    const v = await setup();
    await start(v);
    await fireEvent.click(await v.findByRole("button", { name: "Continuar" }));
    expect(v.onNext).toHaveBeenCalledWith({ serverUrl: "https://pc.t.ts.net", serverAdminLogin: "dayan@x" });
  });

  test("sin tailscale serve no se queda atascado: pista, Atrás y continuar de todos modos", async () => {
    const v = await setup({ serveOk: false });
    await start(v);
    expect(await v.findByText("tailscale serve --bg 4747")).toBeTruthy();
    await fireEvent.click(v.getByRole("button", { name: "Atrás" }));
    expect(v.onBack).toHaveBeenCalled();
    await fireEvent.click(v.getByRole("button", { name: "Continuar de todos modos (solo en este equipo)" }));
    expect(v.onNext).toHaveBeenCalledWith({ serverUrl: "https://pc.t.ts.net", serverAdminLogin: "dayan@x" });
  });

  test("si la comprobación de tailscale serve falla, también hay salida", async () => {
    const v = await setup({ serveOk: new Error("tailscale no responde") });
    await start(v);
    expect(await v.findByText("tailscale no responde")).toBeTruthy();
    expect(v.getByRole("button", { name: "Atrás" })).toBeTruthy();
    expect(v.getByRole("button", { name: "Continuar de todos modos (solo en este equipo)" })).toBeTruthy();
  });

  test("pasar a «me conecto a otro servidor» con el servidor en marcha pide confirmación y lo detiene", async () => {
    const v = await setup();
    await start(v);
    await fireEvent.click(v.getByRole("radio", { name: /Me conecto al servidor/ }));
    expect(v.native.stopServer).not.toHaveBeenCalled();
    expect(v.queryByLabelText("URL del servidor")).toBeNull();
    // «No» vuelve al modo servidor con el servidor intacto.
    await fireEvent.click(v.getByRole("button", { name: "No, este equipo es el servidor" }));
    expect(v.getByText(/Servidor en marcha/)).toBeTruthy();
    await fireEvent.click(v.getByRole("radio", { name: /Me conecto al servidor/ }));
    await fireEvent.click(v.getByRole("button", { name: "Sí, detener el servidor" }));
    expect(v.native.stopServer).toHaveBeenCalled();
    expect(await v.findByLabelText("URL del servidor")).toBeTruthy();
    expect(v.app.server?.running).toBe(false);
  });
});
