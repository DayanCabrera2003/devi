import { describe, expect, test } from "bun:test";
import { API, ChatFromSessionMeta } from "./api";
import { AUDIT_ACTIONS, AUDIT_FEATURES, AUDIT_TARGETS, legacyAuditAction, legacyAuditTarget } from "./audit";
import { CHAT_LIMITS, ChatMessageSchema, ChatQuery, SendChatMeta } from "./chat";
import { InboxItemSchema } from "./entities";
import { SessionDeliverySchema, UserEventSchema } from "./events";
import { SESSION_FEATURES } from "./notices";

const msg = { id: "c1", fromMemberId: "m1", toMemberId: "m2", text: "hola", files: [], createdAt: 1, origin: "app" as const, fromSessionName: "" };

describe("chat", () => {
  test("el mensaje valida y el texto no puede ir vacío", () => {
    expect(ChatMessageSchema.parse(msg)).toEqual(msg);
    expect(SendChatMeta.parse({ to: "m2", text: "  hola " }).text).toBe("hola");
    expect(SendChatMeta.safeParse({ to: "m2", text: "   " }).success).toBe(false);
    expect(SendChatMeta.safeParse({ to: "m2", text: "x".repeat(CHAT_LIMITS.maxChars + 1) }).success).toBe(false);
  });

  test("enviar y mandar a mi sesión son acciones humanas; leer no", () => {
    expect(API.sendChat.human).toBe(true);
    expect(API.sendChat.perm).toBe("requests.send");
    expect(API.chatToSession.human).toBe(true);
    expect(API.chatToSession.actor).toBe("party");
    expect("human" in API.chatPage).toBe(false);
    expect(API.chatPage.actor).toBe("party");
  });

  test("escribir desde una sesión no es humano y exige approval", () => {
    expect("human" in API.chatFromSession).toBe(false);
    expect(API.chatFromSession.perm).toBe("requests.send");
    expect(ChatFromSessionMeta.safeParse({ sessionId: "s1", to: "m2", text: "hola" }).success).toBe(false);
    expect(ChatFromSessionMeta.parse({ sessionId: "s1", to: "m2", text: "hola", approval: "chat" }).approval).toBe("chat");
  });

  test("paginación: por defecto y con tope", () => {
    expect(ChatQuery.parse({}).limit).toBe(CHAT_LIMITS.defaultPage);
    expect(ChatQuery.safeParse({ limit: CHAT_LIMITS.maxPage + 1 }).success).toBe(false);
  });

  test("evento chat.message, entrega y bandeja de kind chat, y la sesión lo declara", () => {
    expect(UserEventSchema.parse({ type: "chat.message", message: msg }).type).toBe("chat.message");
    expect(SessionDeliverySchema.safeParse({ kind: "chat", content: "x", meta: {} }).success).toBe(true);
    expect(InboxItemSchema.safeParse({ id: "i", kind: "chat", content: "x", meta: {}, createdAt: 1 }).success).toBe(true);
    expect(SESSION_FEATURES).toContain("chat");
  });

  test("auditoría: acciones y objetivo nuevos, con equivalente para apps anteriores", () => {
    expect(AUDIT_ACTIONS).toEqual(expect.arrayContaining(["chat.sent", "chat.to_session", "chat.sent_from_session"]));
    expect(AUDIT_TARGETS).toContain("chat");
    expect(AUDIT_FEATURES.chat).toBe("audit_chat");
    expect(legacyAuditAction("chat.sent")).toBe("request.sent_from_app");
    expect(legacyAuditAction("chat.to_session")).toBe("request.forwarded");
    expect(legacyAuditAction("chat.sent_from_session")).toBe("draft.approved_in_chat");
    expect(legacyAuditTarget("chat")).toBe("request");
    expect(legacyAuditTarget("member")).toBe("member");
  });
});
