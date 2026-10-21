import type { z } from "zod";
import { HttpError } from "./http";

// Tope de las rutas JSON (las acciones son mensajes cortos). Solo createDraft (multipart) admite más.
export const MAX_JSON_BODY = 64 * 1024;

const tooLarge = (max: number) =>
  new HttpError(413, `El cuerpo es demasiado grande (máximo ${Math.round(max / 1024)} KB)`, { code: "too_large" });

// Lee el cuerpo contando bytes: corta con 413 en cuanto se pasa del tope, también si llega por chunks
// (sin Content-Length) o si el Content-Length miente.
export async function readLimited(req: Request, max: number): Promise<Uint8Array> {
  if (Number(req.headers.get("Content-Length") ?? 0) > max) throw tooLarge(max);
  if (!req.body) return new Uint8Array();
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      throw tooLarge(max);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

// Lee y valida un cuerpo JSON. Cuerpo vacío = {} (las acciones sin datos no tienen que mandar nada).
// Un ZodError lo convierte createApp en 400.
export async function readBody<S extends z.ZodType>(req: Request, schema: S): Promise<z.output<S>> {
  const text = new TextDecoder().decode(await readLimited(req, MAX_JSON_BODY));
  let raw: unknown = {};
  if (text.trim()) {
    try {
      raw = JSON.parse(text);
    } catch {
      throw new HttpError(400, "El cuerpo no es JSON válido", { code: "invalid" });
    }
  }
  return schema.parse(raw);
}
