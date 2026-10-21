import { expect, test } from "bun:test";
import { channelCheck, formatChecks, parseTailscaleStatus, pluginInstalled } from "./doctor";

test("parseTailscaleStatus: estado y login (UserProfile o mapa User)", () => {
  expect(parseTailscaleStatus(JSON.stringify({ BackendState: "Running", Self: { UserProfile: { LoginName: "ana@x" } } }))).toEqual({
    running: true, login: "ana@x",
  });
  expect(parseTailscaleStatus(JSON.stringify({ BackendState: "Running", Self: { UserID: 7 }, User: { "7": { LoginName: "leo@x" } } }))).toEqual({
    running: true, login: "leo@x",
  });
  expect(parseTailscaleStatus(JSON.stringify({ BackendState: "Stopped", Self: {} }))).toEqual({ running: false, login: null });
  expect(parseTailscaleStatus("no json")).toEqual({ running: false, login: null });
});

test("pluginInstalled", () => {
  expect(pluginInstalled(JSON.stringify([{ id: "devi@devi-local", enabled: true }]))).toEqual({ installed: true, enabled: true });
  expect(pluginInstalled(JSON.stringify([{ id: "devi@devi-local", enabled: false }]))).toEqual({ installed: true, enabled: false });
  expect(pluginInstalled("[]")).toEqual({ installed: false, enabled: false });
  expect(pluginInstalled("basura")).toEqual({ installed: false, enabled: false });
});

test("channelCheck explica qué añadir a las managed settings", () => {
  expect(channelCheck({ found: true, channelsEnabled: true, pluginAllowed: true }).ok).toBe(true);
  const off = channelCheck({ found: true, channelsEnabled: false, pluginAllowed: false });
  expect(off.ok).toBe(false);
  expect(off.fix).toContain('"allowedChannelPlugins"');
  expect(off.fix).toContain('"marketplace": "devi-local"');
  expect(channelCheck({ found: false, channelsEnabled: undefined, pluginAllowed: false })).toMatchObject({ ok: true });
});

test("formatChecks", () => {
  expect(formatChecks([
    { name: "Tailscale", ok: true, detail: "conectado como ana@x" },
    { name: "Plugin", ok: false, detail: "no está instalado", fix: "línea 1\nlínea 2" },
  ])).toBe("✓ Tailscale: conectado como ana@x\n✗ Plugin: no está instalado\n  → línea 1\n    línea 2");
});
