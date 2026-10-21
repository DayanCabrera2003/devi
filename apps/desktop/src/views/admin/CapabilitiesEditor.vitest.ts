import { fireEvent, render } from "@testing-library/svelte";
import { describe, expect, test, vi } from "vitest";
import CapabilitiesEditor from "./CapabilitiesEditor.svelte";

describe("CapabilitiesEditor", () => {
  test("añade recortando y sin duplicados", async () => {
    const onChange = vi.fn();
    const { getByRole, getByLabelText } = render(CapabilitiesEditor, { items: ["Aprobar PRs"], onChange });
    const input = getByLabelText("Nueva capacidad");
    await fireEvent.input(input, { target: { value: "  Desplegar en GCP  " } });
    await fireEvent.click(getByRole("button", { name: "Añadir" }));
    expect(onChange).toHaveBeenLastCalledWith(["Aprobar PRs", "Desplegar en GCP"]);

    onChange.mockClear();
    await fireEvent.input(input, { target: { value: "aprobar prs" } });
    await fireEvent.click(getByRole("button", { name: "Añadir" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  test("Enter también añade", async () => {
    const onChange = vi.fn();
    const { getByLabelText } = render(CapabilitiesEditor, { items: [], onChange });
    const input = getByLabelText("Nueva capacidad");
    await fireEvent.input(input, { target: { value: "Revisar SQL" } });
    await fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(["Revisar SQL"]);
  });

  test("quita una capacidad", async () => {
    const onChange = vi.fn();
    const { getByRole } = render(CapabilitiesEditor, { items: ["A", "B"], onChange });
    await fireEvent.click(getByRole("button", { name: "Quitar A" }));
    expect(onChange).toHaveBeenCalledWith(["B"]);
  });
});
