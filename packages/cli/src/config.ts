import { readFile } from "node:fs/promises";
import { posix, win32 } from "node:path";
import { z } from "zod";
import { clientConfigPath, defaultReceivedDir, type Sys } from "./paths";

// <config del SO>/devi/config.json. La escribe la app de escritorio; la CLI solo la lee.
// Las claves desconocidas se ignoran (la app puede guardar más cosas).
export const ClientConfigSchema = z.object({
  serverUrl: z.url(),
  devUser: z.string().min(1).optional(),
  receivedDir: z.string().min(1).optional(),
});
export type ClientConfig = z.infer<typeof ClientConfigSchema>;

export type ResolvedConfig = { serverUrl: string; devUser: string | undefined; receivedDir: string; path: string };

export class ConfigError extends Error {}

// Una carpeta relativa dependería del cwd de cada sesión: se ignora (con aviso) y se usa la de por defecto.
function validReceivedDir(dir: string | undefined, sys: Sys): string | undefined {
  if (dir === undefined) return undefined;
  if ((sys.platform === "win32" ? win32 : posix).isAbsolute(dir)) return dir;
  console.error(`[devi] aviso: receivedDir "${dir}" no es una ruta absoluta; se ignora y se usa la carpeta por defecto.`);
  return undefined;
}

// DEVI_SERVER_URL y DEVI_DEV_USER tienen prioridad sobre el fichero (tests y depuración).
export async function loadClientConfig(sys: Sys): Promise<ResolvedConfig> {
  const path = clientConfigPath(sys);
  let fromFile: Partial<ClientConfig> = {};
  let text: string | null = null;
  try {
    text = await readFile(path, "utf8");
  } catch {
    // no existe: puede bastar con las variables de entorno
  }
  if (text !== null) {
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new ConfigError(`La configuración de Devi (${path}) no es JSON válido. Ábrela desde la app de Devi para repararla.`);
    }
    const r = ClientConfigSchema.safeParse(data);
    if (!r.success) {
      throw new ConfigError(`La configuración de Devi (${path}) no es válida: ${r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
    }
    fromFile = r.data;
  }
  const serverUrl = sys.env.DEVI_SERVER_URL || fromFile.serverUrl;
  if (!serverUrl) {
    throw new ConfigError(`Devi no está configurado: falta la URL del servidor. Abre la app de Devi y completa el asistente (se guarda en ${path}).`);
  }
  return {
    serverUrl,
    devUser: sys.env.DEVI_DEV_USER || fromFile.devUser,
    receivedDir: validReceivedDir(fromFile.receivedDir, sys) ?? defaultReceivedDir(sys),
    path,
  };
}
