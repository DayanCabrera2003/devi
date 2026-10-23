import { API, ChatFromSessionMeta, ChatQuery, FILE_LIMITS, SendChatMeta } from "@devi/protocol";
import type { z } from "zod";
import { readBody, readLimited } from "../../core/body";
import { HttpError, json } from "../../core/http";
import type { ModuleContext } from "../../core/module";
import type { Router } from "../../core/router";
import type { ChatManager } from "./service";

// Mismo tope que POST /drafts y POST /requests: 5 archivos de 1 MB más el multipart.
const MAX_CHAT_BODY = FILE_LIMITS.maxFiles * FILE_LIMITS.maxBytes + 256 * 1024;

const invalid = (message: string) => new HttpError(400, message, { code: "invalid" });

// Multipart con "meta" (JSON de `schema`) y 0..5 "files".
async function readForm<S extends z.ZodType>(request: Request, schema: S): Promise<{ meta: z.output<S>; files: File[] }> {
  const bytes = await readLimited(request, MAX_CHAT_BODY);
  const contentType = request.headers.get("Content-Type") ?? "";
  const form = await new Response(bytes, { headers: { "Content-Type": contentType } }).formData().catch(() => null);
  if (!form) throw invalid('Se espera multipart/form-data con el campo "meta"');
  const metaRaw = form.get("meta");
  if (typeof metaRaw !== "string") throw invalid('Falta el campo "meta"');
  let parsed: unknown;
  try {
    parsed = JSON.parse(metaRaw);
  } catch {
    throw invalid('El campo "meta" no es JSON válido');
  }
  const files = form.getAll("files");
  if (files.some((f) => !(f instanceof File))) throw invalid('Cada campo "files" debe ser un archivo');
  return { meta: schema.parse(parsed), files: files as File[] };
}

export function registerChatRoutes(r: Router, ctx: ModuleContext, chat: ChatManager): void {
  r.on(API.sendChat, async ({ request, access }) => {
    const { meta, files } = await readForm(request, SendChatMeta);
    if (files.length > 0) ctx.rateLimit.take("draftFiles", access.memberId);
    return json(await chat.sendFromApp(access, meta, files));
  });

  r.on(API.chatFromSession, async ({ request, access }) => {
    const { meta, files } = await readForm(request, ChatFromSessionMeta);
    if (files.length > 0) ctx.rateLimit.take("draftFiles", access.memberId);
    return json(await chat.sendFromSession(access, meta, files));
  });

  r.on(API.chatPage, ({ url, params, access }) => {
    const q = ChatQuery.parse(Object.fromEntries(url.searchParams));
    return json(chat.page(access.memberId, params.memberId!, q));
  });

  r.on(API.chatToSession, async ({ request, params, access }) => {
    const { sessionId } = await readBody(request, API.chatToSession.body);
    chat.toSession(access, params.id!, sessionId);
    return json({ ok: true });
  });
}
