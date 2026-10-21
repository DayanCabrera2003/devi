import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pluginFiles, renderJson } from "./plugin";
import { CLI_VERSION } from "./version";

test("plugin.json: MCP, canal y hooks en forma exec apuntando al binario", () => {
  const files = pluginFiles("/home/a/.local/share/devi/bin/devi", "1.2.3");
  expect(Object.keys(files).sort()).toEqual([".claude-plugin/marketplace.json", "devi/.claude-plugin/plugin.json"]);
  expect(files[".claude-plugin/marketplace.json"]).toMatchObject({
    name: "devi-local",
    owner: { name: "Devi" },
    plugins: [{ name: "devi", source: "./devi", version: "1.2.3" }],
  });
  const plugin = files["devi/.claude-plugin/plugin.json"] as Record<string, unknown>;
  expect(plugin).toMatchObject({
    name: "devi",
    version: "1.2.3",
    mcpServers: { devi: { command: "/home/a/.local/share/devi/bin/devi", args: ["mcp"] } },
    channels: [{ server: "devi", displayName: "Devi" }],
    hooks: {
      // Sin canal, estos dos hooks recogen la bandeja (plazo de ~4 s): por eso su timeout es 10.
      SessionStart: [{ hooks: [{ type: "command", command: "/home/a/.local/share/devi/bin/devi", args: ["hook", "start"], timeout: 10 }] }],
      UserPromptSubmit: [{ hooks: [{ type: "command", command: "/home/a/.local/share/devi/bin/devi", args: ["hook", "working"], timeout: 10 }] }],
      Stop: [{ hooks: [{ type: "command", command: "/home/a/.local/share/devi/bin/devi", args: ["hook", "idle"], timeout: 5 }] }],
    },
  });
});

test("la copia de referencia en plugin/ coincide con el generador (bin = devi del PATH)", () => {
  const root = join(import.meta.dir, "../../../plugin");
  for (const [rel, content] of Object.entries(pluginFiles("devi", CLI_VERSION))) {
    expect(readFileSync(join(root, rel), "utf8")).toBe(renderJson(content));
  }
});
