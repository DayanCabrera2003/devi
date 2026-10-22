import { API, KnowledgeQuery } from "@devi/protocol";
import { json } from "../../core/http";
import type { DeviModule } from "../../core/module";
import { KnowledgeManager } from "./service";
import { KnowledgeStore, knowledgeMigrations } from "./store";

// Base de conocimiento del equipo: escucha "request.shared" (lo emite requests cuando alguien responde con
// "Guardar en la base del equipo"), lo indexa con FTS5 y ofrece búsqueda (cualquier miembro, también el
// agente) y retirada (acción humana: quien respondió o un admin).
export const knowledgeModule: DeviModule = {
  name: "knowledge",
  migrations: knowledgeMigrations,

  routes(r, ctx) {
    const knowledge = new KnowledgeManager(new KnowledgeStore(ctx.db), ctx);
    ctx.bus.on("request.shared", (s) => knowledge.onShared(s));
    r.on(API.searchKnowledge, ({ url }) => {
      const q = KnowledgeQuery.parse(Object.fromEntries(url.searchParams));
      return json({ entries: knowledge.search(q.q, q.limit) });
    });
    r.on(API.withdrawKnowledge, ({ params, access }) => {
      knowledge.withdraw(access, params.id!);
      return json({ ok: true });
    });
  },
};
