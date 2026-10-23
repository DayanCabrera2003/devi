import { z } from "zod";
import { FileMetaSchema } from "./entities";

// Chat entre personas: mensajes sin plazo ni estados (a diferencia de las solicitudes). Cualquiera de las dos
// partes puede mandar un mensaje, con sus adjuntos, a una de sus sesiones de Claude Code (POST /chat/:id/session).
// origin: app = lo escribió la persona en la app; session = lo escribió su Claude con reply_in_chat (aprobado en el
// aviso de permisos de Claude Code). fromSessionName solo con origin session.
export const ChatMessageSchema = z.object({
  id: z.string(),
  fromMemberId: z.string(),
  toMemberId: z.string(),
  text: z.string(),
  files: z.array(FileMetaSchema),
  createdAt: z.number(),
  origin: z.enum(["app", "session"]),
  fromSessionName: z.string(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const CHAT_LIMITS = { maxChars: 20_000, defaultPage: 50, maxPage: 200 } as const;

export const ChatText = z.string().trim().min(1).max(CHAT_LIMITS.maxChars);

// POST /chat es multipart: "meta" (JSON de este esquema) + 0..5 "files", como POST /requests.
export const SendChatMeta = z.object({ to: z.string(), text: ChatText });

// GET /chat/:memberId?before=&limit=: de lo más nuevo a lo más viejo, por createdAt.
export const ChatQuery = z.object({
  limit: z.coerce.number().int().min(1).max(CHAT_LIMITS.maxPage).default(CHAT_LIMITS.defaultPage),
  before: z.coerce.number().int().positive().optional(),
});
export const ChatPageSchema = z.object({ messages: z.array(ChatMessageSchema), nextBefore: z.number().optional() });
export type ChatPage = z.infer<typeof ChatPageSchema>;
