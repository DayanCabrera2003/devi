import { API, ConversationQuery, SendFromAppMeta } from "@devi/protocol";
import { readLimited } from "../../core/body";
import { HttpError, json } from "../../core/http";
import type { ModuleContext } from "../../core/module";
import type { Router } from "../../core/router";
import type { Conversations } from "./conversations";
import { MAX_DRAFT_BODY } from "./routes";
import type { RequestsManager } from "./service";

const invalid = (message: string) => new HttpError(400, message, { code: "invalid" });

// POST /requests: multipart con "meta" (JSON de SendFromAppMeta) y 0..5 "files". Mismo tope que POST /drafts.
async function readSendForm(request: Request) {
  const bytes = await readLimited(request, MAX_DRAFT_BODY);
  const contentType = request.headers.get("Content-Type") ?? "";
  const form = await new Response(bytes, { headers: { "Content-Type": contentType } }).formData().catch(() => null);
  if (!form) throw invalid('POST /requests espera multipart/form-data con el campo "meta"');
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
  return { meta: SendFromAppMeta.parse(parsed), files: files as File[] };
}

// Rutas de la app: enviar una solicitud escrita por la persona y leer las conversaciones por compañero.
export function registerAppRoutes(r: Router, ctx: ModuleContext, requests: RequestsManager, conversations: Conversations): void {
  r.on(API.sendFromApp, async ({ request, access }) => {
    const { meta, files } = await readSendForm(request);
    if (files.length > 0) ctx.rateLimit.take("draftFiles", access.memberId);
    return json(await requests.sendFromApp(access, meta, files));
  });

  r.on(API.conversations, ({ access }) => json({ items: conversations.list(access.memberId) }));

  r.on(API.conversation, ({ url, params, access }) => {
    const q = ConversationQuery.parse(Object.fromEntries(url.searchParams));
    return json(conversations.page(access.memberId, params.memberId!, q));
  });
}
