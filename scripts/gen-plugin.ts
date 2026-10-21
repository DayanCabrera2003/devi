// Regenera plugin/: la copia de referencia del marketplace local de Devi, con el binario `devi`
// buscado en el PATH. La instalación real la escribe `devi install-integration` con la ruta absoluta.
// Uso: bun scripts/gen-plugin.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pluginFiles, renderJson } from "../packages/cli/src/plugin";
import { CLI_VERSION } from "../packages/cli/src/version";

const root = join(import.meta.dir, "..", "plugin");
for (const [rel, content] of Object.entries(pluginFiles("devi", CLI_VERSION))) {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, renderJson(content));
  console.log(`✓ ${path}`);
}
