import { type InjectionScan, type RequestContext, contextText, hasContext, scanForInjection } from "@devi/protocol";

const RANK = { none: 0, warn: 1, high: 2 } as const;

// Posible prompt injection en una solicitud: mensaje, contexto y archivos, con el mismo análisis que las tarjetas
// de la app. Cualquier aviso (warn o high) cuenta: lo que se trae a una sesión desde el chat no se revisa en la app.
export function injectionIn(message: string, context: RequestContext | undefined, files: { name: string; bytes: Uint8Array }[] = []): InjectionScan {
  const decoder = new TextDecoder();
  const scans = [
    scanForInjection(message),
    scanForInjection(hasContext(context) ? contextText(context) : ""),
    ...files.map((f) => scanForInjection(decoder.decode(f.bytes))),
  ];
  let level: InjectionScan["level"] = "none";
  const reasons: string[] = [];
  for (const s of scans) {
    if (RANK[s.level] > RANK[level]) level = s.level;
    for (const r of s.reasons) if (!reasons.includes(r)) reasons.push(r);
  }
  return { level, reasons };
}
