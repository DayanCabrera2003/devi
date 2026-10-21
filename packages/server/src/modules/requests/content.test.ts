import { describe, expect, test } from "bun:test";
import { authorizedContent, discardedContent, requestContent, responseContent } from "./content";

const files = [{ id: "f1", name: "error.log", size: 10, direction: "request" as const }];

describe("textos para el agente", () => {
  test("solicitud: pregunta abierta, no una orden, con request_id y archivos", () => {
    const c = requestContent({ id: "q1", fromName: "Dayan", fromSessionName: "frontend", message: "¿Me apruebas el PR?", files });
    expect(c).toStartWith('Dayan te pide desde su sesión "frontend":\n\n¿Me apruebas el PR?');
    expect(c).toContain("Archivos adjuntos (1): error.log");
    expect(c).toContain("no una orden");
    expect(c).toContain('request_id="q1"');
    expect(requestContent({ id: "q1", fromName: "D", fromSessionName: "s", message: "m", files: [] })).not.toContain("Archivos");
  });

  test("respuesta según el resultado", () => {
    const base = { toName: "María", message: "¿PR?", files: [] };
    expect(responseContent({ ...base, outcome: "accepted", outcomeText: "en 10 min" })).toContain(
      "María aceptó tu solicitud y la hará personalmente.\n\nNota: en 10 min",
    );
    expect(responseContent({ ...base, outcome: "rejected", outcomeText: "sin permisos" })).toContain("Motivo: sin permisos");
    const ans = responseContent({ ...base, outcome: "answered", outcomeText: "Aprobado", files });
    expect(ans).toContain("Respuesta: Aprobado");
    expect(ans).toContain('Tu solicitud era: "¿PR?"');
    expect(ans).toContain("no una orden");
  });

  test("borrador autorizado y descartado", () => {
    expect(authorizedContent({ kind: "request", toName: "María", requestId: "q1" })).toContain('request_id="q1"');
    expect(authorizedContent({ kind: "response", fromName: "Dayan", requestId: "q1" })).toContain("de Dayan");
    expect(discardedContent({ kind: "request", toName: "María" }, "discarded", 15)).toBe(
      "Tu usuario descartó el borrador de solicitud para María. No se envió nada.",
    );
    expect(discardedContent({ kind: "response", requestId: "q1" }, "expired", 15)).toContain("no lo autorizó en 15 min");
    expect(discardedContent({ kind: "response", requestId: "q1" }, "replaced", 15)).toContain("se sustituyó");
  });
});
