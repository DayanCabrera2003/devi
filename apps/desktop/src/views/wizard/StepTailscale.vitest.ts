import { fireEvent, render } from "@testing-library/svelte";
import { describe, expect, test, vi } from "vitest";
import { fakeApp } from "../../lib/test-app";
import StepTailscale from "./StepTailscale.svelte";

describe("StepTailscale", () => {
  test("con Tailscale continúa con el login detectado", async () => {
    const self = { login: "dayan@x", dnsName: "pc.t.ts.net" };
    const { context } = await fakeApp({}, { tailscaleSelf: vi.fn(async () => self) });
    const onNext = vi.fn();
    const { findByRole } = render(StepTailscale, { context, props: { onNext } });
    await fireEvent.click(await findByRole("button", { name: "Continuar" }));
    expect(onNext).toHaveBeenCalledWith(self);
  });

  test("modo desarrollo: el botón solo se activa con un usuario y lo pasa recortado", async () => {
    const tailscaleSelf = vi.fn(async () => {
      throw "Tailscale no está instalado";
    });
    const { context } = await fakeApp({}, { tailscaleSelf });
    const onNext = vi.fn();
    const { findByText, getByRole, getByLabelText } = render(StepTailscale, { context, props: { onNext } });
    expect(await findByText("Tailscale no está instalado")).toBeTruthy();
    const dev = getByRole("button", { name: "Continuar sin Tailscale (modo desarrollo)" }) as HTMLButtonElement;
    expect(dev.disabled).toBe(true);
    await fireEvent.input(getByLabelText(/Usuario de desarrollo/), { target: { value: "  dayan@dev " } });
    expect(dev.disabled).toBe(false);
    await fireEvent.click(dev);
    expect(onNext).toHaveBeenCalledWith(null, "dayan@dev");
  });

  test("Reintentar borra el error anterior", async () => {
    const tailscaleSelf = vi
      .fn()
      .mockRejectedValueOnce("primer fallo")
      .mockRejectedValueOnce("segundo fallo");
    const { context } = await fakeApp({}, { tailscaleSelf });
    const { findByText, getByRole, queryByText } = render(StepTailscale, { context, props: { onNext: vi.fn() } });
    expect(await findByText("primer fallo")).toBeTruthy();
    await fireEvent.click(getByRole("button", { name: "Reintentar" }));
    expect(await findByText("segundo fallo")).toBeTruthy();
    expect(queryByText("primer fallo")).toBeNull();
  });
});
