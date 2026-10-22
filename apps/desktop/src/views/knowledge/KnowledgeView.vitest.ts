import { fireEvent, render, waitFor } from "@testing-library/svelte";
import type { KnowledgeEntry } from "@devi/protocol";
import { describe, expect, test, vi } from "vitest";
import { fakeApp } from "../../lib/test-app";
import { ME } from "../../lib/test-fixtures";
import KnowledgeView from "./KnowledgeView.svelte";

const entry = (id: string, over: Partial<KnowledgeEntry> = {}): KnowledgeEntry => ({
  id, requestId: `q-${id}`, question: `¿Pregunta ${id}?`, answer: `Respuesta ${id}`, askedBy: "m1", askedByName: "Dayan",
  answeredBy: "m2", answeredByName: "María", createdAt: Date.UTC(2026, 9, 12, 12), ...over,
});
const NOT_ADMIN = { ...ME, perms: ["requests.send" as const], roles: [] };

describe("Base del equipo", () => {
  test("al abrir muestra las más recientes: pregunta, respuesta, quién y cuándo (como texto)", async () => {
    const searchKnowledge = vi.fn(async () => ({ entries: [entry("a", { answer: "<b>make deploy</b>" })] }));
    const { context } = await fakeApp({ searchKnowledge });
    const { findByText, getByText, container } = render(KnowledgeView, { context });
    expect(await findByText("¿Pregunta a?")).toBeTruthy();
    expect(searchKnowledge).toHaveBeenCalledWith("", expect.any(Number));
    expect(getByText("<b>make deploy</b>")).toBeTruthy();
    expect(container.querySelector("b")).toBeNull();
    expect(getByText(/María explicó esto el/).textContent).toMatch(/2026/);
  });

  test("buscar pide al servidor con el texto escrito", async () => {
    const searchKnowledge = vi.fn(async (q: string) => ({ entries: q ? [entry("b")] : [] }));
    const { context } = await fakeApp({ searchKnowledge });
    const { getByRole, findByText } = render(KnowledgeView, { context });
    await waitFor(() => expect(searchKnowledge).toHaveBeenCalledTimes(1));
    const box = getByRole("searchbox", { name: "Buscar en la base del equipo" });
    await fireEvent.input(box, { target: { value: "staging" } });
    await fireEvent.submit(box.closest("form")!);
    expect(await findByText("¿Pregunta b?")).toBeTruthy();
    expect(searchKnowledge).toHaveBeenLastCalledWith("staging", expect.any(Number));
  });

  test("Retirar: solo en mis respuestas si no soy admin; al retirar desaparece", async () => {
    const searchKnowledge = vi.fn(async () => ({ entries: [entry("mia", { answeredBy: "m1", answeredByName: "Dayan" }), entry("ajena")] }));
    const withdrawKnowledge = vi.fn(async () => ({ ok: true }));
    const { context } = await fakeApp({ searchKnowledge, withdrawKnowledge, me: vi.fn(async () => NOT_ADMIN) });
    const { findByText, getAllByRole, queryByText } = render(KnowledgeView, { context });
    await findByText("¿Pregunta ajena?");
    const buttons = getAllByRole("button", { name: /Retirar/ });
    expect(buttons).toHaveLength(1);
    await fireEvent.click(buttons[0]!);
    expect(withdrawKnowledge).toHaveBeenCalledWith("mia");
    await waitFor(() => expect(queryByText("¿Pregunta mia?")).toBeNull());
  });

  test("un admin puede retirar cualquiera; sin resultados lo dice", async () => {
    const { context } = await fakeApp({ searchKnowledge: vi.fn(async () => ({ entries: [entry("ajena")] })) });
    const { findAllByRole } = render(KnowledgeView, { context });
    expect(await findAllByRole("button", { name: /Retirar/ })).toHaveLength(1);
    const empty = await fakeApp({ searchKnowledge: vi.fn(async () => ({ entries: [] })) });
    const v = render(KnowledgeView, { context: empty.context });
    expect(await v.findByText(/Todavía no hay nada/)).toBeTruthy();
  });
});
