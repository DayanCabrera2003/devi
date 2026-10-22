import { describe, expect, test, vi } from "vitest";
import { ComposerStore, scanOutgoing } from "./composer.svelte";

const file = (token: string, preview = "hola") => ({ token, name: `${token}.txt`, size: 4, preview });
const SECRET = "API_KEY=sk-proj-Xa81kd02LmQp7Rr5Tt9Vv3Ww6Yy1Zz4Bb8Cc";

function setup() {
  const native = { discardFiles: vi.fn(async () => {}), takeFiles: vi.fn(async (t: string[]) => t.map((x) => ({ name: x, content: "c" }))) };
  const http = { sendFromApp: vi.fn(async (meta: { to: string; message: string }) => ({ id: "q1", ...meta }) as never) };
  const c = new ComposerStore();
  c.to = "m2";
  return { c, native, http };
}

describe("barra de escritura", () => {
  test("no se envía vacía; con texto envía meta y archivos y se vacía", async () => {
    const { c, native, http } = setup();
    expect(c.canSend).toBe(false);
    c.text = "  ¿Me ayudas?  ";
    c.add(native, { files: [file("a")], rejected: [] });
    expect(c.canSend).toBe(true);
    const r = await c.send(http, native);
    expect(r).toBeTruthy();
    expect(native.takeFiles).toHaveBeenCalledWith(["a"]);
    expect(http.sendFromApp).toHaveBeenCalledWith({ to: "m2", message: "¿Me ayudas?" }, [{ name: "a", content: "c" }]);
    expect(c.text).toBe("");
    expect(c.files).toHaveLength(0);
  });

  test("un secreto en el mensaje o en un archivo pide confirmación explícita", () => {
    const { c, native } = setup();
    c.text = "te paso esto";
    c.add(native, { files: [file("env", SECRET)], rejected: [] });
    expect(c.secrets[0]?.where).toBe("env.txt");
    expect(c.canSend).toBe(false);
    c.confirmSecrets = true;
    expect(c.canSend).toBe(true);
    expect(scanOutgoing(SECRET, [])[0]?.where).toBe("el mensaje");
  });

  test("más de 5 archivos: el resto se rechaza y se suelta en Rust", () => {
    const { c, native } = setup();
    c.add(native, { files: ["1", "2", "3", "4", "5", "6"].map((t) => file(t)), rejected: [{ name: "big.bin", reason: "No es texto" }] });
    expect(c.files).toHaveLength(5);
    expect(c.rejected.map((r) => r.name)).toEqual(["big.bin", "6.txt"]);
    expect(native.discardFiles).toHaveBeenCalledWith(["6"]);
  });

  test("quitar un adjunto lo suelta; cambiar de persona suelta todos", async () => {
    const { c, native } = setup();
    c.add(native, { files: [file("a"), file("b")], rejected: [] });
    await c.remove(native, "a");
    expect(native.discardFiles).toHaveBeenCalledWith(["a"]);
    c.text = "borrador";
    await c.reset(native, "m3");
    expect(native.discardFiles).toHaveBeenLastCalledWith(["b"]);
    expect(c.to).toBe("m3");
    expect(c.text).toBe("");
  });

  test("si el envío falla, reintenta sin volver a pedir los archivos a Rust", async () => {
    const { c, native, http } = setup();
    http.sendFromApp.mockRejectedValueOnce(new Error("sin red"));
    c.text = "hola";
    c.add(native, { files: [file("a")], rejected: [] });
    expect(await c.send(http, native)).toBeNull();
    expect(c.error).toBe("sin red");
    expect(c.files).toHaveLength(1);
    await c.send(http, native);
    expect(native.takeFiles).toHaveBeenCalledTimes(1);
    expect(http.sendFromApp).toHaveBeenCalledTimes(2);
  });
});
