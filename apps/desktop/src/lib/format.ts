import type { DeviRequest, Settings } from "@devi/protocol";

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

// ---- ajustes del servidor (Admin → Servidor) ----------------------------------------

// El formulario usa minutos y días; los rangos son los de SettingsSchema en @devi/protocol.
export type SettingsForm = { timeoutMin: number; draftMin: number; retentionDays: number; maxAgeDays: number };

export const SETTINGS_BOUNDS: Record<keyof SettingsForm, { min: number; max: number; range: string }> = {
  timeoutMin: { min: 1, max: 7 * 24 * 60, range: "entre 1 minuto y 7 días (10080 min)" },
  draftMin: { min: 1, max: 24 * 60, range: "entre 1 minuto y 24 horas (1440 min)" },
  retentionDays: { min: 1, max: 30, range: "entre 1 y 30 días" },
  maxAgeDays: { min: 1, max: 30, range: "entre 1 y 30 días" },
};

export type SettingsCheck =
  | { ok: true; settings: Settings }
  | { ok: false; errors: Partial<Record<keyof SettingsForm, string>> };

export function settingsFromForm(f: SettingsForm): SettingsCheck {
  const errors: Partial<Record<keyof SettingsForm, string>> = {};
  for (const key of Object.keys(SETTINGS_BOUNDS) as (keyof SettingsForm)[]) {
    const v = f[key];
    const b = SETTINGS_BOUNDS[key];
    if (typeof v !== "number" || !Number.isInteger(v) || v < b.min || v > b.max) {
      errors[key] = `Escribe un número entero ${b.range}.`;
    }
  }
  if (!errors.retentionDays && !errors.maxAgeDays && f.maxAgeDays < f.retentionDays) {
    errors.maxAgeDays = "No puede ser menor que la retención tras cerrar la solicitud.";
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    settings: {
      requestTimeoutMs: minutesToMs(f.timeoutMin),
      draftTtlMs: minutesToMs(f.draftMin),
      fileRetentionDays: f.retentionDays,
      fileMaxAgeDays: f.maxAgeDays,
    },
  };
}

export function formFromSettings(s: Settings): SettingsForm {
  return {
    timeoutMin: msToMinutes(s.requestTimeoutMs),
    draftMin: msToMinutes(s.draftTtlMs),
    retentionDays: s.fileRetentionDays,
    maxAgeDays: s.fileMaxAgeDays,
  };
}
