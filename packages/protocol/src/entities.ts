import { z } from "zod";
import { PERMS } from "./perms";

export const PermSchema = z.enum(PERMS);

export const RoleSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  color: z.string(),
  capabilities: z.array(z.string().min(1)), // las lee el agente para recomendar a quién pedir
  perms: z.array(PermSchema),
});
export type Role = z.infer<typeof RoleSchema>;

export const MemberSchema = z.object({
  id: z.string(),
  login: z.string().min(1), // login de Tailscale
  name: z.string().min(1),
  description: z.string(),
  roleIds: z.array(z.string()),
  disabled: z.boolean(),
});
export type Member = z.infer<typeof MemberSchema>;

export const SessionStatusSchema = z.enum(["idle", "working"]);
export const SessionSchema = z.object({
  id: z.string(),
  memberId: z.string(),
  name: z.string(),
  cwd: z.string(),
  status: SessionStatusSchema,
  lastSeen: z.number(),
});
export type Session = z.infer<typeof SessionSchema>;

export const FileMetaSchema = z.object({
  id: z.string(),
  name: z.string(),
  size: z.number().int().nonnegative(),
  direction: z.enum(["request", "response"]),
});
export type FileMeta = z.infer<typeof FileMetaSchema>;

const DraftBase = z.object({
  id: z.string(),
  authorMemberId: z.string(),
  authorSessionId: z.string(),
  message: z.string(),
  status: z.enum(["awaiting", "authorized", "discarded"]),
  files: z.array(FileMetaSchema),
  createdAt: z.number(),
  expiresAt: z.number(),
});
export const DraftSchema = z.discriminatedUnion("kind", [
  DraftBase.extend({ kind: z.literal("request"), toMemberId: z.string() }),
  DraftBase.extend({ kind: z.literal("response"), requestId: z.string() }),
]);
export type Draft = z.infer<typeof DraftSchema>;

export const RequestStatusSchema = z.enum([
  "pending", "forwarded", "accepted", "rejected", "answered", "timed_out", "closed",
]);
export type RequestStatus = z.infer<typeof RequestStatusSchema>;

export const DeviRequestSchema = z.object({
  id: z.string(),
  fromMemberId: z.string(),
  fromSessionId: z.string(),
  fromSessionName: z.string(),
  toMemberId: z.string(),
  message: z.string(),
  status: RequestStatusSchema,
  forwardedSessionId: z.string().optional(),
  outcome: z.enum(["accepted", "rejected", "answered"]).optional(),
  outcomeText: z.string().optional(),
  files: z.array(FileMetaSchema),
  responseFiles: z.array(FileMetaSchema),
  createdAt: z.number(),
  sentAt: z.number(),
  deadline: z.number(),
});
export type DeviRequest = z.infer<typeof DeviRequestSchema>;

export const SettingsSchema = z.object({
  requestTimeoutMs: z.number().int().positive(),
  draftTtlMs: z.number().int().positive(),
  fileRetentionDays: z.number().int().positive(),
  fileMaxAgeDays: z.number().int().positive(),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const MeSchema = z.object({
  login: z.string(),
  member: MemberSchema,
  roles: z.array(RoleSchema),
  perms: z.array(PermSchema),
});
export type Me = z.infer<typeof MeSchema>;

export const TeamViewSchema = z.object({
  members: z.array(MemberSchema.extend({ connected: z.boolean() })),
  roles: z.array(RoleSchema),
});
export type TeamView = z.infer<typeof TeamViewSchema>;
