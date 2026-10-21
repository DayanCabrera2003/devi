import type { z } from "zod";
import { HttpError } from "./http";

// Lee y valida un cuerpo JSON. Cuerpo vacío = {} (las acciones sin datos no tienen que mandar nada).
// Un ZodError lo convierte createApp en 400.
export async function readBody<S extends z.ZodType>(req: Request, schema: S): Promise<z.output<S>> {
  const text = await req.text();
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
