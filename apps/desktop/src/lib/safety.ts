// Avisos de prompt injection en las tarjetas: se juntan los análisis del mensaje y de cada archivo.
import type { InjectionScan } from "@devi/protocol";

const RANK = { none: 0, warn: 1, high: 2 } as const;

export function combineScans(scans: InjectionScan[]): InjectionScan {
  let level: InjectionScan["level"] = "none";
  const reasons: string[] = [];
  for (const s of scans) {
    if (RANK[s.level] > RANK[level]) level = s.level;
    for (const r of s.reasons) if (!reasons.includes(r)) reasons.push(r);
  }
  return { level, reasons };
}
