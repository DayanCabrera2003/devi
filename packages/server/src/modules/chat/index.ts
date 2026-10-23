import type { DeviModule } from "../../core/module";
import { registerChatRoutes } from "./routes";
import { ChatManager } from "./service";
import { ChatStore, chatMigrations } from "./store";

// Chat entre personas: mensajes sin plazo ni estados, con adjuntos, y «Enviar a mi sesión».
// Usa los servicios team, sessions, files y settings; ofrece "chat" (requests lo usa para la barra lateral).
export const chatModule: DeviModule = {
  name: "chat",
  migrations: chatMigrations,

  routes(r, ctx) {
    const chat = new ChatManager(new ChatStore(ctx.db), ctx);
    ctx.services.provide("chat", chat);
    ctx.services.provide("chatTargets", {
      chat: { check: (a, id) => chat.claimCheck(a, id), deliverTo: (a, id, sessionId, details) => chat.deliverToClaim(a, id, sessionId, details) },
    });
    registerChatRoutes(r, ctx, chat);
  },
};
