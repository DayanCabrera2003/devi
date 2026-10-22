import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pluginFiles, renderFile } from "./plugin";
import { CLI_VERSION } from "./version";

test("plugin.json: MCP, canal y hooks en forma exec apuntando al binario", () => {
  const files = pluginFiles("/home/a/.local/share/devi/bin/devi", "1.2.3");
  expect(Object.keys(files).sort()).toEqual([".claude-plugin/marketplace.json", "devi/.claude-plugin/plugin.json", "devi/skills/devi/SKILL.md"]);
  expect(files[".claude-plugin/marketplace.json"]).toMatchObject({
    name: "devi-local",
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
    expect(readFileSync(join(root, rel), "utf8")).toBe(renderFile(content));
  }
});

test("metadatos del manifiesto: autor (Dayan, no una herramienta), repositorio, palabras clave", () => {
  const files = pluginFiles("devi", "1.2.3");
  const plugin = files["devi/.claude-plugin/plugin.json"] as Record<string, unknown>;
  expect(plugin).toMatchObject({
    displayName: "Devi",
    author: { name: "Dayan Cabrera", url: "https://github.com/DayanCabrera2003" },
    homepage: "https://github.com/DayanCabrera2003/devi",
    repository: "https://github.com/DayanCabrera2003/devi",
  });
  expect(plugin.keywords).toEqual(expect.arrayContaining(["equipo", "solicitudes", "permisos", "revisiones"]));
  expect(JSON.stringify(files)).not.toMatch(/claude\.com|anthropic/i);
  expect((files[".claude-plugin/marketplace.json"] as { owner: unknown }).owner).toEqual({ name: "Dayan Cabrera", url: "https://github.com/DayanCabrera2003" });
});

test("la skill devi: frontmatter que la activa en los casos de uso, y una guía completa", () => {
  const skill = pluginFiles("devi", "1.2.3")["devi/skills/devi/SKILL.md"] as string;
  expect(typeof skill).toBe("string");
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(skill);
  expect(fm).not.toBeNull();
  expect(fm![1]).toMatch(/^name: devi$/m);
  const description = /^description: (.+)$/m.exec(fm![1]!)![1]!;
  for (const w of ["compañero", "pedir", "permiso", "revisión", "esperando", "Devi", "solicitud"]) expect(description).toContain(w);
  const lines = skill.split("\n").length;
  expect(lines).toBeGreaterThanOrEqual(150);
  expect(lines).toBeLessThanOrEqual(320);
  for (const s of [
    "menor privilegio", "capacidades", "permisos", "borrador", "pending", "forwarded", "timed_out", "receivedDir", "respuesta/",
    "DEVI-UNTRUSTED", "devi doctor", "whoami", "list_teammates", "get_conversation", "list_pending", "get_request",
    "send_request", "respond_to_request", "to_name", "-p",
  ]) expect(skill).toContain(s);
  expect(skill).toMatch(/Ejemplo bueno/);
  expect(skill).toMatch(/Ejemplo malo/);
});
