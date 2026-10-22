import { API, CreateDraftMeta, FILE_LIMITS } from "@devi/protocol";
import { readBody, readLimited } from "../../core/body";
import { HttpError, json } from "../../core/http";
import type { ModuleContext } from "../../core/module";
import { pushUser, userKey } from "../../core/push";
import type { Router } from "../../core/router";
import type { RequestsManager } from "./service";

// Tope del cuerpo de POST /drafts: 5 archivos de 1 MB + margen para el meta y el multipart.
export const MAX_DRAFT_BODY = FILE_LIMITS.maxFiles * FILE_LIMITS.maxBytes + 256 * 1024;

const invalid = (message: string) => new HttpError(400, message, { code: "invalid" });

// POST /drafts: multipart con el campo "meta" (JSON de CreateDraftMeta) y 0..5 campos "files".
async function readDraftForm(request: Request) {
  // Se cuenta mientras se lee (Content-Length y chunks); después se parsea el multipart desde memoria.
  const bytes = await readLimited(request, MAX_DRAFT_BODY);
  const contentType = request.headers.get("Content-Type") ?? "";
  // Sin anotar el tipo: el FormData de Bun y el de los tipos DOM no coinciden en tsc.
  const form = await new Response(bytes, { headers: { "Content-Type": contentType } }).formData().catch(() => null);
  if (!form) throw invalid('POST /drafts espera multipart/form-data con el campo "meta"');
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
  return { meta: CreateDraftMeta.parse(parsed), files: files as File[] };
}

export function registerRequestRoutes(r: Router, ctx: ModuleContext, requests: RequestsManager): void {
  r.on(API.createDraft, async ({ request, access }) => {
    const { meta, files } = await readDraftForm(request);
    if (files.length > 0) ctx.rateLimit.take("draftFiles", access.memberId);
    return json(await requests.createDraft(access, meta, files));
  });
  r.on(API.authorizeDraft, ({ params, access }) => json(requests.authorize(access, params.id!)));
  r.on(API.discardDraft, ({ params, access }) => json(requests.discardByAuthor(access, params.id!)));

  r.on(API.forwardRequest, async ({ request, params, access }) => {
    const { sessionId } = await readBody(request, API.forwardRequest.body);
    return json(requests.forward(access, params.id!, sessionId));
  });
  r.on(API.acceptRequest, async ({ request, params, access }) => {
    const { note, shareWithTeam } = await readBody(request, API.acceptRequest.body);
    return json(requests.accept(access, params.id!, note, shareWithTeam));
  });
  r.on(API.rejectRequest, async ({ request, params, access }) => {
    const { reason } = await readBody(request, API.rejectRequest.body);
    return json(requests.reject(access, params.id!, reason));
  });

  r.on(API.acceptResponse, ({ params, access }) => json(requests.acceptResponse(access, params.id!)));
  r.on(API.forwardResponse, async ({ request, params, access }) => {
    const { sessionId } = await readBody(request, API.forwardResponse.body);
    return json(requests.forwardResponse(access, params.id!, sessionId));
  });
  r.on(API.resendRequest, ({ params, access }) => json(requests.resend(access, params.id!)));
  r.on(API.ignoreRequest, ({ params, access }) => json(requests.ignore(access, params.id!)));
  r.on(API.reassignRequest, async ({ request, params, access }) => {
    const { to } = await readBody(request, API.reassignRequest.body);
    return json(requests.reassign(access, params.id!, to));
  });

  // SSE de la app. Al (re)conectar recibe las tarjetas que siguen abiertas.
  r.on(API.userEvents, ({ request, access }) =>
    ctx.presence.open(userKey(access.memberId), request.signal, {
      onOpen: () => {
        for (const ev of requests.openCards(access.memberId)) pushUser(ctx.sse, access.memberId, ev);
      },
    }),
  );

  // Solo en modo dev: en producción la ruta no existe (404).
  if (ctx.config.dev) {
    r.on(API.debugPush, async ({ request, access }) =>
      json({ delivered: requests.debugPush(access, await readBody(request, API.debugPush.body)) }),
    );
  }
}
