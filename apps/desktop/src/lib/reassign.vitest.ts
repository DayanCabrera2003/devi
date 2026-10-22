import { describe, expect, test } from "vitest";
import type { Role, TeamView } from "@devi/protocol";
import { canReassign, reassignCandidates } from "./reassign";
import { req } from "./test-fixtures";

const roles: Role[] = [{ id: "r2", name: "DevOps", color: "#000", capabilities: ["permisos GCP", "despliegues"], perms: ["requests.send"] }];
const member = (id: string, name: string, over: object = {}) => ({ id, login: `${id}@x`, name, description: "", roleIds: [], disabled: false, connected: false, ...over });
const team: TeamView = {
  members: [
    member("m1", "Dayan", { connected: true }),
    member("m2", "María", { connected: true }),
    member("m3", "Leo", { roleIds: ["r2"] }),
    member("m4", "Ana", { connected: true }),
    member("m5", "Pablo", { disabled: true, connected: true }),
  ],
  roles,
};

describe("reassignCandidates", () => {
  test("sin mí, sin el destinatario actual ni desactivados; conectados primero y por nombre", () => {
    const list = reassignCandidates(team, "m1", "m2");
    expect(list.map((c) => c.id)).toEqual(["m4", "m3"]);
    expect(list[1]).toMatchObject({ name: "Leo", connected: false, roles: ["DevOps"], capabilities: ["permisos GCP", "despliegues"] });
  });
});

describe("canReassign", () => {
  test("solo mis solicitudes pending o timed_out", () => {
    expect(canReassign(req({ fromMemberId: "m1", status: "pending" }), "m1")).toBe(true);
    expect(canReassign(req({ fromMemberId: "m1", status: "timed_out" }), "m1")).toBe(true);
    expect(canReassign(req({ fromMemberId: "m1", status: "forwarded" }), "m1")).toBe(false);
    expect(canReassign(req({ fromMemberId: "m1", status: "closed" }), "m1")).toBe(false);
    expect(canReassign(req({ fromMemberId: "m2", status: "pending" }), "m1")).toBe(false);
  });
});
