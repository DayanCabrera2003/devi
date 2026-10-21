import { fireEvent, render } from "@testing-library/svelte";
import { describe, expect, test, vi } from "vitest";
import type { Session } from "@devi/protocol";
import { fakeApp } from "../lib/test-app";
import { SESSIONS, req } from "../lib/test-fixtures";
import ResponseCard from "./ResponseCard.svelte";

const answered = req({ fromMemberId: "m1", toMemberId: "m2", status: "answered", outcome: "answered", outcomeText: "Hecho" });

describe("ResponseCard", () => {
  test("montar la tarjeta no carga las sesiones", async () => {
    const { api, context } = await fakeApp();
    const { getByRole } = render(ResponseCard, { props: { request: answered }, context });
    expect(api.memberSessions).not.toHaveBeenCalled();
    expect(getByRole("button", { name: "Enviar a sesión" })).toBeTruthy();
  });

  test("Enviar a sesión carga las sesiones al abrir el selector, con estado de carga", async () => {
    let release: (v: Session[]) => void = () => {};
    const memberSessions = vi.fn(() => new Promise<Session[]>((ok) => (release = ok)));
    const { context } = await fakeApp({ memberSessions });
    const { getByRole, findByText } = render(ResponseCard, { props: { request: answered }, context });
    await fireEvent.click(getByRole("button", { name: "Enviar a sesión" }));
    expect(memberSessions).toHaveBeenCalledOnce();
    const loadingBtn = getByRole("button", { name: /Buscando sesiones/ }) as HTMLButtonElement;
    expect(loadingBtn.disabled).toBe(true);
    release(SESSIONS);
    expect(await findByText("frontend")).toBeTruthy();
    expect(await findByText("¿A qué sesión se la pasas?")).toBeTruthy();
  });
});
