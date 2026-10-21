import { describe, expect, test } from "bun:test";
import { channelArgs, decideChannelMode, policyFrom } from "./channel-policy";

describe("política de canales", () => {
  test("sin managed settings → modo dev", () => {
    const p = policyFrom([]);
    expect(p).toEqual({ found: false, channelsEnabled: undefined, pluginAllowed: false });
    expect(decideChannelMode("auto", p)).toBe("dev");
  });

  test("permitido explícitamente → plugin", () => {
    const p = policyFrom([{ channelsEnabled: true, allowedChannelPlugins: [{ marketplace: "devi-local", plugin: "devi" }] }]);
    expect(p.pluginAllowed).toBe(true);
    expect(decideChannelMode("auto", p)).toBe("plugin");
  });

  test("canales activos pero devi no está en la lista → dev", () => {
    const p = policyFrom([{ channelsEnabled: true, allowedChannelPlugins: [{ marketplace: "otro", plugin: "devi" }] }]);
    expect(decideChannelMode("auto", p)).toBe("dev");
  });

  test("los ficheros posteriores mandan (managed-settings.d)", () => {
    const p = policyFrom([
      { channelsEnabled: true, allowedChannelPlugins: [{ marketplace: "devi-local", plugin: "devi" }] },
      { channelsEnabled: false },
    ]);
    expect(p.channelsEnabled).toBe(false);
    expect(decideChannelMode("auto", p)).toBe("dev");
  });

  test("el modo pedido explícitamente gana", () => {
    expect(decideChannelMode("plugin", policyFrom([]))).toBe("plugin");
    expect(decideChannelMode("dev", policyFrom([{ channelsEnabled: true, allowedChannelPlugins: ["devi@devi-local"] }]))).toBe("dev");
  });

  test("flags de claude", () => {
    expect(channelArgs("plugin")).toEqual(["--channels", "plugin:devi@devi-local"]);
    expect(channelArgs("dev")).toEqual(["--dangerously-load-development-channels", "plugin:devi@devi-local"]);
  });
});
