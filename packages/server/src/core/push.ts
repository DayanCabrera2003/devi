import { SESSION_EVENT, type SessionDelivery, type UserEvent } from "@devi/protocol";
import type { SseHub } from "./sse";

// Claves SSE y envíos tipados. Devuelven true si había al menos un stream abierto.
export const userKey = (memberId: string) => `user:${memberId}`;
export const sessionKey = (sessionId: string) => `session:${sessionId}`;

export const pushUser = (sse: SseHub, memberId: string, event: UserEvent) => sse.send(userKey(memberId), event.type, event);

export const deliverToSession = (sse: SseHub, sessionId: string, delivery: SessionDelivery) =>
  sse.send(sessionKey(sessionId), SESSION_EVENT, delivery);
