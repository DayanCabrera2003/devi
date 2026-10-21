import { fireEvent, render } from "@testing-library/svelte";
import { beforeEach, describe, expect, test, vi } from "vitest";
import StepIntegration from "./StepIntegration.svelte";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

const JSON_OK = '{"ok":true,"binPath":"/h/.local/bin/devi","marketplaceDir":"/m","steps":[]}';

const ALIAS_OK = { code: 0, stdout: "✓ /h/.zshrc: instalado\n", stderr: "" };

async function run(stdout: string, code = 0, opts: { alias?: boolean; aliasOut?: unknown } = {}) {
  invoke.mockImplementation(async (_cmd: string, payload?: { args: string[] }) =>
    payload?.args[0] === "shell-alias" ? (opts.aliasOut ?? ALIAS_OK) : { code, stdout, stderr: "" },
  );
  const onNext = vi.fn();
  const view = render(StepIntegration, { onNext, onBack: vi.fn() });
  const alias = view.getByRole("checkbox", { name: /Usar Devi automáticamente al escribir/ }) as HTMLInputElement;
  expect(alias.checked).toBe(true);
  if (opts.alias === false) await fireEvent.click(alias);
  const continuar = view.getByRole("button", { name: "Continuar" }) as HTMLButtonElement;
  expect(continuar.disabled).toBe(true);
  await fireEvent.click(view.getByRole("button", { name: "Instalar integración" }));
  await view.findByText(/Hecho|Terminó/);
  return { ...view, continuar, onNext };
}

describe("StepIntegration", () => {
  beforeEach(() => invoke.mockReset());

  test("Continuar se activa con la línea JSON ok de install-integration", async () => {
    const v = await run(`Copiando…\n${JSON_OK}\n`);
    expect(invoke).toHaveBeenCalledWith("run_devi", { args: ["install-integration", "--json"] });
    expect(v.continuar.disabled).toBe(false);
    expect(invoke).toHaveBeenCalledWith("run_devi", { args: ["shell-alias", "install"] });
    expect(await v.findByText(/Listo: en las terminales nuevas/)).toBeTruthy();
    expect(v.getByText("/h/.local/bin/devi")).toBeTruthy();
    await fireEvent.click(v.continuar);
    expect(v.onNext).toHaveBeenCalled();
  });

  test("ok:false en el JSON no deja continuar ni instala la función claude", async () => {
    const v = await run('{"ok":false,"binPath":"","marketplaceDir":"","steps":[]}');
    expect(v.continuar.disabled).toBe(true);
    expect(invoke).not.toHaveBeenCalledWith("run_devi", { args: ["shell-alias", "install"] });
  });

  test("sin la casilla marcada no se instala la función claude", async () => {
    const v = await run(JSON_OK, 0, { alias: false });
    expect(v.continuar.disabled).toBe(false);
    expect(invoke).not.toHaveBeenCalledWith("run_devi", { args: ["shell-alias", "install"] });
  });

  test("si falla shell-alias install, se ve el error pero se puede continuar", async () => {
    const v = await run(JSON_OK, 0, { aliasOut: { code: 1, stdout: "", stderr: "[devi] no encontré ningún shell compatible\n" } });
    expect(await v.findByText(/no encontré ningún shell compatible/)).toBeTruthy();
    expect(v.continuar.disabled).toBe(false);
  });

  test("explica que no aplica a terminales de IDE ni a cmd.exe", async () => {
    invoke.mockReset();
    const view = render(StepIntegration, { onNext: vi.fn(), onBack: vi.fn() });
    expect(view.getByText(/cmd\.exe/)).toBeTruthy();
  });

  test("sin línea JSON no se da por instalada aunque el código sea 0", async () => {
    const v = await run("Instalado, creo\n");
    expect(v.continuar.disabled).toBe(true);
  });

  test("código distinto de 0 no deja continuar", async () => {
    const v = await run(JSON_OK, 1);
    expect(v.continuar.disabled).toBe(true);
  });
});
