import type { DeviRequest } from "@devi/protocol";

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1_048_576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1_048_576).toFixed(1)} MB`;
}

// Cuánto se esperó antes del timeout, en texto corto.
export function waited(r: Pick<DeviRequest, "sentAt" | "deadline">): string {
  const ms = Math.max(0, r.deadline - r.sentAt);
  const min = Math.round(ms / 60_000);
  if (min >= 60) return `${Math.round(min / 60)} h`;
  if (min >= 1) return `${min} min`;
  return `${Math.round(ms / 1000)} s`;
}

export type Outcome = "accepted" | "rejected" | "answered";

export const OUTCOME: Record<Outcome, { label: string; cls: string; lead: string }> = {
  accepted: { label: "Aceptada", cls: "ok", lead: "Lo hará personalmente." },
  rejected: { label: "Rechazada", cls: "no", lead: "Motivo:" },
  answered: { label: "Respondida", cls: "", lead: "Desde su sesión de Claude Code:" },
};

export function truncate(s: string, max = 140): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

export type UrlCheck = { ok: true; url: string } | { ok: false; error: string };

// El servidor se publica con `tailscale serve` en https://<equipo>.<tailnet>.ts.net.
// http solo se admite contra 127.0.0.1, localhost o [::1] (servidor en modo dev), igual que en Rust.
export function normalizeServerUrl(raw: string): UrlCheck {
  const text = raw.trim().replace(/\/+$/, "");
  let u: URL;
  try {
    u = new URL(text);
  } catch {
    return { ok: false, error: "Escribe una URL completa, p. ej. https://pc.tu-tailnet.ts.net" };
  }
  const local = u.hostname === "127.0.0.1" || u.hostname === "localhost" || u.hostname === "[::1]";
  if (u.protocol === "http:" && local) return { ok: true, url: u.origin };
  if (u.protocol !== "https:") return { ok: false, error: "La URL debe empezar por https://" };
  if (!u.hostname.endsWith(".ts.net")) {
    return { ok: false, error: "Devi se conecta por Tailscale: usa https://<equipo>.<tailnet>.ts.net" };
  }
  return { ok: true, url: u.origin };
}

export const msToMinutes = (ms: number) => Math.round(ms / 60_000);
export const minutesToMs = (min: number) => Math.round(min * 60_000);

// `devi install-integration --json` deja un objeto JSON en la última línea de stdout.
export function lastJsonLine<T>(stdout: string): T | null {
  const line = stdout.trim().split(/\r?\n/).pop()?.trim() ?? "";
  if (!line.startsWith("{")) return null;
  try {
    return JSON.parse(line) as T;
  } catch {
    return null;
  }
}
