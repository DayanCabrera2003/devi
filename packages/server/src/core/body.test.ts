import { expect, test } from "bun:test";
import { z } from "zod";
import { readBody } from "./body";
import { HttpError } from "./http";

const post = (body?: string) => new Request("http://x/", { method: "POST", body });

test("cuerpo vacío = {}", async () => {
  expect(await readBody(post(), z.object({ note: z.string().optional() }))).toEqual({});
});

test("JSON válido se valida con el esquema", async () => {
  expect(await readBody(post('{"sessionId":"s1"}'), z.object({ sessionId: z.string() }))).toEqual({ sessionId: "s1" });
  await expect(readBody(post('{"sessionId":1}'), z.object({ sessionId: z.string() }))).rejects.toThrow();
});

test("JSON roto → HttpError 400", async () => {
  const e = await readBody(post("{no"), z.object({})).catch((x) => x);
  expect(e).toBeInstanceOf(HttpError);
  expect((e as HttpError).status).toBe(400);
});
