import { fireEvent, render } from "@testing-library/svelte";
import { describe, expect, test, vi } from "vitest";
import type { AuditEntry } from "../../lib/audit";
import { fakeApp } from "../../lib/test-app";
import Admin from "./Admin.svelte";
import AuditTab from "./AuditTab.svelte";

const e = (id: string, over: Partial<AuditEntry> = {}): AuditEntry => ({
  id, at: Date.UTC(2026, 9, 21, 10, 0), actorMemberId: "m1", actorLogin: "dayan@x",
  action: "member.updated", targetType: "member", targetId: "m2", details: { perms: "team.admin" }, ...over,
});

describe("AuditTab", () => {
  test("tabla con fecha, quién, acción en español, destino y detalles", async () => {
    const audit = vi.fn(async () => ({ entries: [e("a1"), e("a2", { action: "role.deleted", targetType: "role", targetId: "r9", details: {} })] }));
    const { context } = await fakeApp({ audit });
    const { findByText, getByText, getAllByText, container } = render(AuditTab, { context });
    expect(await findByText("Persona modificada", { selector: "td" })).toBeTruthy();
    expect(audit).toHaveBeenCalledWith({ limit: 50 });
    expect(getByText("Rol eliminado", { selector: "td" })).toBeTruthy();
    expect(getByText("Persona: María")).toBeTruthy();
    expect(getByText("perms: team.admin")).toBeTruthy();
    expect(container.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(container.querySelector("tbody tr td")?.textContent).toMatch(/2026/);
    expect(getAllByText(/Dayan \(dayan@x\)/)).toHaveLength(2);
  });

  test("filtro por acción", async () => {
    const audit = vi.fn(async () => ({ entries: [e("a1"), e("a2", { action: "role.deleted" }), e("a3")] }));
    const { context } = await fakeApp({ audit });
    const { findByText, getByLabelText, container } = render(AuditTab, { context });
    await findByText("Rol eliminado", { selector: "td" });
    await fireEvent.change(getByLabelText("Filtrar por acción"), { target: { value: "role.deleted" } });
    expect(container.querySelectorAll("tbody tr")).toHaveLength(1);
    await fireEvent.change(getByLabelText("Filtrar por acción"), { target: { value: "" } });
    expect(container.querySelectorAll("tbody tr")).toHaveLength(3);
  });

  test("Cargar más pide la página siguiente con nextBefore y desaparece al final", async () => {
    const audit = vi
      .fn()
      .mockResolvedValueOnce({ entries: [e("a1")], nextBefore: 111 })
      .mockResolvedValueOnce({ entries: [e("a0", { action: "role.created" })] });
    const { context } = await fakeApp({ audit });
    const { findByRole, findByText, queryByRole, container } = render(AuditTab, { context });
    await fireEvent.click(await findByRole("button", { name: "Cargar más" }));
    expect(audit).toHaveBeenLastCalledWith({ limit: 50, before: 111 });
    expect(await findByText("Rol creado", { selector: "td" })).toBeTruthy();
    expect(container.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(queryByRole("button", { name: "Cargar más" })).toBeNull();
  });

  test("todo se pinta como texto, nunca como HTML", async () => {
    const audit = vi.fn(async () => ({
      entries: [e("a1", { actorLogin: "<img src=x onerror=alert(1)>", details: { nota: "<b>hola</b>" } })],
    }));
    const { context } = await fakeApp({ audit });
    const { findByText, container } = render(AuditTab, { context });
    expect(await findByText("nota: <b>hola</b>")).toBeTruthy();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("tbody b")).toBeNull();
  });

  test("error del servidor", async () => {
    const audit = vi.fn(async () => {
      throw { status: 404, body: { error: "no existe" } };
    });
    const { context } = await fakeApp({ audit });
    const { findByText } = render(AuditTab, { context });
    expect(await findByText("no existe")).toBeTruthy();
  });

  test("las alertas en vivo aparecen arriba y se dan por vistas", async () => {
    const audit = vi.fn(async () => ({ entries: [e("a1")] }));
    const { app, context } = await fakeApp({ audit });
    app.auditAlerts = [e("a9", { action: "settings.updated" })];
    const { findByText, container } = render(AuditTab, { context });
    expect(await findByText("Ajustes del servidor cambiados", { selector: "td" })).toBeTruthy();
    expect(container.querySelector("tbody tr")?.textContent).toContain("Ajustes del servidor cambiados");
    expect(app.auditAlerts).toEqual([]);
  });
});

describe("Admin: pestaña Auditoría", () => {
  test("muestra el número de alertas nuevas y lo limpia al abrirla", async () => {
    const audit = vi.fn(async () => ({ entries: [] }));
    const { app, context } = await fakeApp({ audit, getSettings: vi.fn(async () => ({})) });
    app.auditAlerts = [e("a1"), e("a2")];
    const { getByRole, findAllByText } = render(Admin, { context });
    const tab = getByRole("button", { name: /Auditoría/ });
    expect(tab.textContent).toContain("2");
    await fireEvent.click(tab);
    expect(await findAllByText("Persona modificada", { selector: "td" })).toHaveLength(2); // las alertas, en la tabla
    expect(app.auditAlerts).toEqual([]);
    expect(getByRole("button", { name: /Auditoría/ }).textContent).not.toContain("2");
  });
});
