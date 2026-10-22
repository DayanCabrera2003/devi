// Conversaciones por persona, envío desde la app y archivos nativos, en un solo sitio para las
// stores y el modo demo. Los nombres son los de @devi/protocol, @devi/client y lib/native.ts.
import type { ConversationPage, ConversationSummary, ConversationsResponse, DeviRequest } from "@devi/protocol";
import type { DeviApi } from "./api";
import { type PickResult, type PickedFile, native } from "./native";

export type { ConversationPage, ConversationsResponse, PickResult, PickedFile };
export type ConversationItem = ConversationSummary;
export type RequestOrigin = DeviRequest["origin"];
export type ThreadRequest = DeviRequest;
export type RejectedFile = PickResult["rejected"][number];
export type SendMeta = { to: string; message: string };
export type OutgoingFile = { name: string; content: string };

export const CONVERSATION_UPDATED = "conversation.updated";

export interface ConversationsHttp {
  conversations(): Promise<ConversationsResponse>;
  conversation(memberId: string, opts?: { before?: number; limit?: number }): Promise<ConversationPage>;
  sendFromApp(meta: SendMeta, files: OutgoingFile[]): Promise<ThreadRequest>;
}

export function conversationsHttp(api: Pick<DeviApi, "conversations" | "conversation" | "sendFromApp">): ConversationsHttp {
  return {
    conversations: () => api.conversations(),
    conversation: (memberId, opts) => api.conversation(memberId, opts),
    sendFromApp: (meta, files) => api.sendFromApp(meta, files),
  };
}

export interface NativeFiles {
  pickFiles(): Promise<PickResult>;
  takeFiles(tokens: string[]): Promise<OutgoingFile[]>;
  discardFiles(tokens: string[]): Promise<void>;
  onFilesDropped(cb: (r: PickResult) => void): Promise<() => void>;
  onDragHover(cb: (s: { active: boolean }) => void): Promise<() => void>;
}

export const nativeFiles: NativeFiles = {
  pickFiles: () => native.pickFiles(),
  takeFiles: (tokens) => native.takeFiles(tokens),
  discardFiles: (tokens) => native.discardFiles(tokens),
  onFilesDropped: (cb) => native.onFilesDropped(cb),
  onDragHover: (cb) => native.onDragHover(cb),
};
