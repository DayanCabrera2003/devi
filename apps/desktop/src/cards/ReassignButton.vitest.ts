import { fireEvent, render } from "@testing-library/svelte";
import { describe, expect, test, vi } from "vitest";
import { fakeApp } from "../lib/test-app";
import { DAYAN, MARIA, ME, req } from "../lib/test-fixtures";
import ReassignButton from "./ReassignButton.svelte";

const LEO = { id: "m3", login: "leo@x", name: "Leo", description: "Infra", roleIds: [], disabled: false };
const team = vi.fn(async () => ({ members: [{ ...DAYAN, connected: true }, { ...MARIA, connected: true }, { ...LEO, connected: false }], roles: ME.roles }));
const mine = req({ id: "q7", fromMemberId: "m1", toMemberId: "m2", status: "pending" });

describe("ReassignButton", () => {
  test("abre el selector con el resto del equipo y se la pide a la persona elegida", async () => {
    const reassignRequest = vi.fn(async () => ({ request: req({ id: "q8", fromMemberId: "m1", toMemberId: "m3" }), original: { ...mine, status: "closed" } }));
    const { context } = await fakeApp({ team, reassignRequest });
    const { getByRole, queryByRole, findByText } = render(ReassignButton, { props: { request: mine }, context });
    await fireEvent.click(getByRole("button", { name: "Pedírselo a otra persona" }));
    expect(await findByText(/¿A quién se lo pides\?/)).toBeTruthy();
    expect(queryByRole("button", { name: /María/ })).toBeNull(); // la destinataria actual no sale
    expect(queryByRole("button", { name: /Dayan/ })).toBeNull();
    await fireEvent.click(getByRole("button", { name: /Leo/ }));
    expect(reassignRequest).toHaveBeenCalledWith("q7", "m3");
  });

  test("si el servidor falla, se queda abierto y muestra el error", async () => {
    const reassignRequest = vi.fn(async () => {
      throw { status: 409, body: { error: "la solicitud ya está closed", code: "conflict" } };
    });
    const { context } = await fakeApp({ team, reassignRequest });
    const { getByRole, findByText } = render(ReassignButton, { props: { request: mine }, context });
    await fireEvent.click(getByRole("button", { name: "Pedírselo a otra persona" }));
    await fireEvent.click(await findByText("Leo"));
    expect(await findByText("la solicitud ya está closed")).toBeTruthy();
  });
});
