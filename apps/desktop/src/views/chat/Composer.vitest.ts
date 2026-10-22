import { fireEvent, render } from "@testing-library/svelte";
import { describe, expect, test, vi } from "vitest";
import { fakeApp } from "../../lib/test-app";
import { req } from "../../lib/test-fixtures";
import Composer from "./Composer.svelte";

const SECRET = "API_KEY=sk-proj-Xa81kd02LmQp7Rr5Tt9Vv3Ww6Yy1Zz4Bb8Cc";

async function mount(files = {}) {
  const sendFromApp = vi.fn(async () => req({ id: "q-app", fromMemberId: "m1", toMemberId: "m2", origin: "app" }));
  const t = await fakeApp({}, {}, { sendFromApp }, files);
  await t.app.openConversation("m2");
  return { ...t, sendFromApp, ...render(Composer, { props: { name: "María" }, context: t.context }) };
}

describe("Composer", () => {
  test("Enviar se activa con texto y Ctrl+Enter envía", async () => {
    const { getByRole, getByLabelText, sendFromApp } = await mount();
    const send = getByRole("button", { name: "Enviar" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    const field = getByLabelText("Mensaje para María");
    await fireEvent.input(field, { target: { value: "¿Me revisas el PR?" } });
    expect(send.disabled).toBe(false);
    await fireEvent.keyDown(field, { key: "Enter", ctrlKey: true });
    await vi.waitFor(() => expect(sendFromApp).toHaveBeenCalledWith({ to: "m2", message: "¿Me revisas el PR?" }, []));
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
