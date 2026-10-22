// Datos de prueba compartidos por los tests (*.vitest.ts). No se importa desde la app.
import type { DeviRequest, Draft, Me, Member, Session, TeamView } from "@devi/protocol";

export const DAYAN: Member = { id: "m1", login: "dayan@x", name: "Dayan", description: "", roleIds: ["r1"], disabled: false };
export const MARIA: Member = { id: "m2", login: "maria@x", name: "María", description: "Backend", roleIds: [], disabled: false };

export const ME: Me = {
  login: "dayan@x",
  member: DAYAN,
  roles: [{ id: "r1", name: "Admin", color: "#ffffff", capabilities: [], perms: ["team.admin", "requests.send"] }],
  perms: ["team.admin", "requests.send"],
};

export const TEAM: TeamView = {
  members: [
    { ...DAYAN, connected: true },
    { ...MARIA, connected: false },
  ],
  roles: ME.roles,
};

export function req(over: Partial<DeviRequest> = {}): DeviRequest {
  return {
    id: "q1",
    origin: "session",
    kind: "request",
    fromMemberId: "m2",
    fromSessionId: "s9",
    fromSessionName: "backend",
    toMemberId: "m1",
    message: "¿Me apruebas el PR?",
    status: "pending",
    files: [],
    responseFiles: [],
    createdAt: 1,
    sentAt: 1_000,
    deadline: 3_601_000,
    ...over,
  };
}

export function draft(over: Record<string, unknown> = {}): Draft {
  return {
    id: "d1",
    kind: "request",
    toMemberId: "m2",
    authorMemberId: "m1",
    authorSessionId: "s1",
    message: "Hola María, ¿me miras esto?",
    status: "awaiting",
    files: [],
    createdAt: 1,
    expiresAt: 900_001,
    ...over,
  } as Draft;
}

export const SESSIONS: Session[] = [
  { id: "s1", memberId: "m1", name: "frontend", cwd: "/w/front", status: "idle", lastSeen: 1, channel: true },
  { id: "s2", memberId: "m1", name: "api", cwd: "/w/api", status: "working", lastSeen: 1, channel: false },
];
