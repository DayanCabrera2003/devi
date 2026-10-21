import { expect, test } from "bun:test";
import { z } from "zod";
import { MAX_JSON_BODY, readBody, readLimited } from "./body";
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

const chunked = (size: number, chunk = 1024) =>
  new Request("http://x/", {
    method: "POST",
    duplex: "half",
    body: new ReadableStream({
      start(c) {
        for (let n = 0; n < size; n += chunk) c.enqueue(new Uint8Array(Math.min(chunk, size - n)).fill(32));
        c.close();
      },
    }),
  } as RequestInit);

test("tope JSON de 64 KB: por Content-Length y por chunks → 413", async () => {
  const big = post(" ".repeat(MAX_JSON_BODY + 1));
  const e1 = await readBody(big, z.object({})).catch((x) => x);
  expect((e1 as HttpError).status).toBe(413);
  const e2 = await readBody(chunked(MAX_JSON_BODY + 1), z.object({})).catch((x) => x);
  expect((e2 as HttpError).status).toBe(413);
  expect(await readBody(chunked(MAX_JSON_BODY), z.object({}))).toEqual({});
});

test("readLimited corta en cuanto se pasa del tope", async () => {
  const e = await readLimited(chunked(10_000), 4_000).catch((x) => x);
  expect((e as HttpError).status).toBe(413);
  expect((await readLimited(chunked(3_000), 4_000)).byteLength).toBe(3_000);
});
