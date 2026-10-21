import { fireEvent, render } from "@testing-library/svelte";
import { describe, expect, test, vi } from "vitest";
import { fakeApp } from "../../lib/test-app";
import ShellAliasSetting from "./ShellAliasSetting.svelte";

const status = (installed: boolean) => ({
  code: 0,
  stdout: JSON.stringify({ installed, files: [{ path: "/h/.zshrc", installed }] }) + "\n",
  stderr: "",
});

async function setup(runDevi: (args: string[]) => Promise<unknown>) {
  const native = { runDevi: vi.fn(runDevi) };
  const t = await fakeApp({}, native);
  const view = render(ShellAliasSetting, { context: t.context });
  const box = view.getByRole("checkbox", { name: /Usar Devi automáticamente al escribir/ }) as HTMLInputElement;
  return { ...view, box, native };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("ShellAliasSetting", () => {
  test("refleja shell-alias status --json", async () => {
    const v = await setup(async () => status(true));
    await flush();
    expect(v.native.runDevi).toHaveBeenCalledWith(["shell-alias", "status", "--json"]);
    expect(v.box.checked).toBe(true);
  });

  test("al marcarla instala y al desmarcarla quita", async () => {
    let installed = false;
    const v = await setup(async (args) => {
      if (args[1] === "install") installed = true;
      if (args[1] === "remove") installed = false;
      return args[1] === "status" ? status(installed) : { code: 0, stdout: "", stderr: "" };
    });
    await flush();
    expect(v.box.checked).toBe(false);
    await fireEvent.click(v.box);
    await flush();
    expect(v.native.runDevi).toHaveBeenCalledWith(["shell-alias", "install"]);
    expect(v.box.checked).toBe(true);
    await fireEvent.click(v.box);
    await flush();
    expect(v.native.runDevi).toHaveBeenCalledWith(["shell-alias", "remove"]);
    expect(v.box.checked).toBe(false);
  });

  test("si falla la instalación, muestra el error y la casilla vuelve a su estado", async () => {
    const v = await setup(async (args) =>
      args[1] === "status" ? status(false) : { code: 1, stdout: "", stderr: "[devi] devi no está instalado en /x\n" },
    );
    await flush();
    await fireEvent.click(v.box);
    expect(await v.findByText(/devi no está instalado en \/x/)).toBeTruthy();
    expect(v.box.checked).toBe(false);
  });

  test("si el comando ni se puede lanzar, lo dice y la casilla vuelve a su estado", async () => {
    const v = await setup(async (args) => {
      if (args[1] === "status") return status(true);
      throw "invocación de devi no permitida";
    });
    await flush();
    await fireEvent.click(v.box);
    expect(await v.findByText("invocación de devi no permitida")).toBeTruthy();
    expect(v.box.checked).toBe(true);
  });
});
