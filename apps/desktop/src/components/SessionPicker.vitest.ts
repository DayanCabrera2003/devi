import { render } from "@testing-library/svelte";
import { describe, expect, test, vi } from "vitest";
import { SESSIONS } from "../lib/test-fixtures";
import { deliveryBadge } from "../lib/stores/sessions.svelte";
import SessionPicker from "./SessionPicker.svelte";

const props = { loading: false, error: null, title: "t", hint: "h", onPick: vi.fn(async () => {}), onBack: vi.fn() };

describe("SessionPicker: cómo llega la entrega", () => {
  test("con canal, 'en tiempo real'; sin canal, 'al escribir' con explicación", () => {
    const { getByRole } = render(SessionPicker, { ...props, sessions: SESSIONS });
    const live = getByRole("button", { name: /frontend/ });
    expect(live.textContent).toContain("en tiempo real");
    const typed = getByRole("button", { name: /api/ });
    expect(typed.textContent).toContain("al escribir");
    const badge = [...typed.querySelectorAll(".badge")].find((b) => b.textContent?.includes("al escribir"));
    expect(badge?.getAttribute("title")).toBe("Llegará cuando escribas algo en esa sesión");
  });

  test("deliveryBadge", () => {
    expect(deliveryBadge({ channel: true })).toEqual({ label: "en tiempo real", title: "Llega a la sesión al momento" });
    expect(deliveryBadge({ channel: false })).toEqual({ label: "al escribir", title: "Llegará cuando escribas algo en esa sesión" });
  });
});
