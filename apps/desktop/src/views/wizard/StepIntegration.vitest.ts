import { fireEvent, render } from "@testing-library/svelte";
import { beforeEach, describe, expect, test, vi } from "vitest";
import StepIntegration from "./StepIntegration.svelte";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

const JSON_OK = '{"ok":true,"binPath":"/h/.local/bin/devi","marketplaceDir":"/m","steps":[]}';

async function run(stdout: string, code = 0) {
  invoke.mockResolvedValue({ code, stdout, stderr: "" });
  const onNext = vi.fn();
  const view = render(StepIntegration, { onNext, onBack: vi.fn() });
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
    expect(v.getByText("/h/.local/bin/devi")).toBeTruthy();
    await fireEvent.click(v.continuar);
    expect(v.onNext).toHaveBeenCalled();
  });

  test("ok:false en el JSON no deja continuar", async () => {
    const v = await run('{"ok":false,"binPath":"","marketplaceDir":"","steps":[]}');
    expect(v.continuar.disabled).toBe(true);
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
