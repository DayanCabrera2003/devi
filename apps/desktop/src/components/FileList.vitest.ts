import { fireEvent, render } from "@testing-library/svelte";
import { describe, expect, test, vi } from "vitest";
import FileList from "./FileList.svelte";

const files = [
  { id: "f1", name: "log.txt", size: 2048, direction: "request" as const },
  { id: "f2", name: "notas.md", size: 10, direction: "request" as const },
];

describe("FileList", () => {
  test("muestra nombre y tamaño", () => {
    const { getByText } = render(FileList, { files, load: vi.fn() });
    expect(getByText("log.txt")).toBeTruthy();
    expect(getByText("2.0 KB")).toBeTruthy();
  });

  test("la vista previa se carga una vez y se puede cerrar", async () => {
    const load = vi.fn(async () => "línea 1\nlínea 2");
    const { getByRole, findByText, queryByText } = render(FileList, { files, load });
    const btn = getByRole("button", { name: /log\.txt/ });
    await fireEvent.click(btn);
    expect(await findByText(/línea 1/)).toBeTruthy();
    await fireEvent.click(btn);
    expect(queryByText(/línea 1/)).toBeNull();
    await fireEvent.click(btn);
    expect(await findByText(/línea 1/)).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith("f1");
  });

  test("error de carga visible", async () => {
    const load = vi.fn(async () => Promise.reject(new Error("sin permiso")));
    const { getByRole, findByText } = render(FileList, { files, load });
    await fireEvent.click(getByRole("button", { name: /notas\.md/ }));
    expect(await findByText("sin permiso")).toBeTruthy();
  });
});
