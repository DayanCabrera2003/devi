import { expect, test } from "bun:test";
import { fakeClient } from "./fake-client";
import { relayDelivery } from "./relay";

const D = { kind: "request" as const, content: "María pide algo", meta: { request_id: "q1", inbox_id: "i1" } };

test("con canal: lo empuja por el canal y confirma su inbox_id", async () => {
  const f = fakeClient({ ackInbox: { ok: true } });
  const sent: unknown[] = [];
  await relayDelivery(D, { channel: true, client: f.client, receivedDir: "/nunca", notify: async (m) => void sent.push(m), log: () => {} });
  expect(sent).toEqual([{ content: "María pide algo", meta: { request_id: "q1", inbox_id: "i1", kind: "request" } }]);
  expect(f.calls).toEqual([{ name: "ackInbox", opts: { body: { ids: ["i1"] } } }]);
});

test("con canal y sin inbox_id (debug o servidor viejo): no confirma nada", async () => {
  const f = fakeClient();
  const sent: unknown[] = [];
  await relayDelivery({ kind: "debug", content: "hola", meta: {} }, {
    channel: true, client: f.client, receivedDir: "/nunca", notify: async (m) => void sent.push(m), log: () => {},
  });
  expect(sent).toHaveLength(1);
  expect(f.calls).toEqual([]);
});

test("sin canal: ni se empuja ni se confirma (lo recoge el hook)", async () => {
  const f = fakeClient();
  const sent: unknown[] = [];
  await relayDelivery(D, { channel: false, client: f.client, receivedDir: "/nunca", notify: async (m) => void sent.push(m), log: () => {} });
  expect(sent).toEqual([]);
  expect(f.calls).toEqual([]);
});

test("si el canal falla, no se confirma (queda en la bandeja)", async () => {
  const f = fakeClient();
  const logs: unknown[] = [];
  await relayDelivery(D, {
    channel: true, client: f.client, receivedDir: "/nunca", notify: async () => { throw new Error("cerrado"); }, log: (...a) => logs.push(a),
  });
  expect(f.calls).toEqual([]);
  expect(logs).toHaveLength(1);
});
