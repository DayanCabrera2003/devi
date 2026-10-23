import { fireEvent, render } from "@testing-library/svelte";
import { describe, expect, test, vi } from "vitest";
import { fakeApp } from "../../lib/test-app";
import { chatMsg, req } from "../../lib/test-fixtures";
import Composer from "./Composer.svelte";

const SECRET = "API_KEY=sk-proj-Xa81kd02LmQp7Rr5Tt9Vv3Ww6Yy1Zz4Bb8Cc";

async function mount(files = {}) {
  const sendFromApp = vi.fn(async () => req({ id: "q-app", fromMemberId: "m1", toMemberId: "m2", origin: "app" }));
  const sendChat = vi.fn(async () => chatMsg({ id: "c-app", fromMemberId: "m1", toMemberId: "m2" }));
  const t = await fakeApp({}, {}, { sendFromApp, sendChat }, files);
  await t.app.openConversation("m2");
  return { ...t, sendFromApp, sendChat, ...render(Composer, { props: { name: "María" }, context: t.context }) };
}

describe("Composer", () => {
  test("Enviar se activa con texto y Enter envía", async () => {
    const { getByRole, getByLabelText, sendChat } = await mount();
    const send = getByRole("button", { name: "Enviar" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    const field = getByLabelText("Mensaje para María");
    await fireEvent.input(field, { target: { value: "¿Me revisas el PR?" } });
    expect(send.disabled).toBe(false);
    await fireEvent.keyDown(field, { key: "Enter" });
    await vi.waitFor(() => expect(sendChat).toHaveBeenCalledWith({ to: "m2", text: "¿Me revisas el PR?" }, []));
  });

  test("Ctrl+Enter también envía", async () => {
    const { getByLabelText, sendChat } = await mount();
    const field = getByLabelText("Mensaje para María");
    await fireEvent.input(field, { target: { value: "hola" } });
    await fireEvent.keyDown(field, { key: "Enter", ctrlKey: true });
    await vi.waitFor(() => expect(sendChat).toHaveBeenCalledWith({ to: "m2", text: "hola" }, []));
  });

  test("Shift+Enter hace salto de línea y no envía", async () => {
    const { getByLabelText, sendFromApp, sendChat } = await mount();
    const field = getByLabelText("Mensaje para María");
    await fireEvent.input(field, { target: { value: "línea uno" } });
    const ev = new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true, cancelable: true });
    field.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(sendFromApp).not.toHaveBeenCalled();
    expect(sendChat).not.toHaveBeenCalled();
  });

  test("Enter mientras se compone con un IME (tildes, CJK) no envía", async () => {
    const { getByLabelText, sendChat } = await mount();
    const field = getByLabelText("Mensaje para María");
    await fireEvent.input(field, { target: { value: "hola" } });
    await fireEvent.keyDown(field, { key: "Enter", isComposing: true });
    expect(sendChat).not.toHaveBeenCalled();
  });

  test("interruptor Mensaje / Solicitud: por defecto Mensaje; con Solicitud sale con plazo (sendFromApp)", async () => {
    const { getByRole, getByLabelText, sendFromApp, sendChat } = await mount();
    const message = getByRole("radio", { name: "Mensaje" }) as HTMLInputElement;
    const request = getByRole("radio", { name: "Solicitud" }) as HTMLInputElement;
    expect(message.checked).toBe(true);
    await fireEvent.click(request);
    expect(getByLabelText("Solicitud para María")).toBeTruthy();
    await fireEvent.input(getByLabelText("Solicitud para María"), { target: { value: "¿Me apruebas el PR?" } });
    await fireEvent.keyDown(getByLabelText("Solicitud para María"), { key: "Enter" });
    await vi.waitFor(() => expect(sendFromApp).toHaveBeenCalledWith({ to: "m2", message: "¿Me apruebas el PR?" }, []));
    expect(sendChat).not.toHaveBeenCalled();
  });

  test("+ adjunta con pickFiles; el chip se puede quitar y previsualizar", async () => {
    const pickFiles = vi.fn(async () => ({ files: [{ token: "t1", name: "notas.md", size: 10, preview: "línea uno" }], rejected: [{ name: "foto.png", reason: "No es un archivo de texto" }] }));
    const { getByRole, findByRole, findByText, queryByText, files } = await mount({ pickFiles });
    await fireEvent.click(getByRole("button", { name: "Adjuntar archivos" }));
    await fireEvent.click(await findByRole("button", { name: "notas.md" }));
    expect(await findByText("línea uno")).toBeTruthy();
    expect(await findByText(/No se adjuntó foto\.png/)).toBeTruthy();
    await fireEvent.click(getByRole("button", { name: "Quitar notas.md" }));
    expect(files.discardFiles).toHaveBeenCalledWith(["t1"]);
    expect(queryByText("notas.md")).toBeNull();
  });

  test("un posible secreto avisa y solo se envía tras confirmarlo", async () => {
    const { getByRole, getByLabelText, findByText } = await mount();
    await fireEvent.input(getByLabelText("Mensaje para María"), { target: { value: SECRET } });
    expect(await findByText(/Parece que hay un secreto/)).toBeTruthy();
    const send = getByRole("button", { name: "Enviar" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    await fireEvent.click(getByLabelText("Enviar de todos modos"));
    expect(send.disabled).toBe(false);
  });
});
