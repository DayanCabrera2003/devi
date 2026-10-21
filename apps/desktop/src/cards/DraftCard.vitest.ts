import { render } from "@testing-library/svelte";
import { afterEach, describe, expect, test, vi } from "vitest";
import { fakeApp } from "../lib/test-app";
import { draft, req } from "../lib/test-fixtures";
import DraftCard from "./DraftCard.svelte";

const file = { id: "f1", name: "parche.diff", size: 10, direction: "response" as const };

describe("DraftCard", () => {
  afterEach(() => vi.useRealTimers());

  test("borrador de respuesta: mensaje, archivos y la solicitud original como contexto", async () => {
    const { app, context } = await fakeApp();
    const original = req({ id: "q1", message: `<b>ojo</b> ${"x".repeat(300)}` });
    app.inbox.applyRequest(original, "m1");
    const d = draft({ kind: "response", requestId: "q1", message: "Hecho, te paso el parche", files: [file] });
    const { getByText, container } = render(DraftCard, { props: { draft: d }, context });
    expect(getByText("Respuesta a María")).toBeTruthy();
    expect(getByText("Hecho, te paso el parche")).toBeTruthy();
    expect(getByText("parche.diff")).toBeTruthy();
    const ctx = container.querySelector(".draft-context");
    expect(ctx?.textContent).toContain("<b>ojo</b>"); // como texto, nunca HTML
    expect(container.querySelector("b")).toBeNull();
    const excerpt = ctx?.querySelector(".excerpt")?.textContent ?? "";
    expect(excerpt.length).toBeLessThanOrEqual(202);
    expect(excerpt).toContain("…");
  });

  test("si la solicitud no está en la bandeja muestra su id corto y no pide nada", async () => {
    const { app, api, context } = await fakeApp();
    const d = draft({ kind: "response", requestId: "0123456789abcdef", message: "Listo" });
    const before = Object.values(api).map((f) => f.mock.calls.length);
    const { getByText } = render(DraftCard, { props: { draft: d }, context });
    expect(getByText("Respuesta a la solicitud 01234567")).toBeTruthy();
    expect(getByText("Listo")).toBeTruthy();
    expect(Object.values(api).map((f) => f.mock.calls.length)).toEqual(before);
    expect(app.inbox.cards).toHaveLength(0);
  });

  test("borrador de solicitud: muestra a quién va", async () => {
    const { context } = await fakeApp();
    const { getByText } = render(DraftCard, { props: { draft: draft() }, context });
    expect(getByText("Claude quiere enviar esto a María")).toBeTruthy();
  });

  test("Caduca en N min se actualiza con el reloj compartido", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const { app, context } = await fakeApp();
    const stop = app.clock.start();
    const { getByText, findByText } = render(DraftCard, { props: { draft: draft({ expiresAt: 15 * 60_000 }) }, context });
    expect(getByText(/Caduca en 15 min/)).toBeTruthy();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(await findByText(/Caduca en 10 min/)).toBeTruthy();
    stop();
  });
});
