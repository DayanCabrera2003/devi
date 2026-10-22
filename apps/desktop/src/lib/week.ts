// «Tu semana»: cuándo toca enseñarla y cómo se escriben sus números. Funciones puras, en hora local.

// Semana ISO de un instante ("2026-W43"): de lunes a domingo, con el año al que pertenece su jueves.
export function weekKey(ms: number): string {
  const d = new Date(ms);
  const day = (d.getDay() + 6) % 7; // lunes = 0
  const thursday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - day + 3);
  const year = thursday.getFullYear();
  const firstThursday = new Date(year, 0, 4);
  const firstMonday = new Date(year, 0, 4 - ((firstThursday.getDay() + 6) % 7));
  const week = 1 + Math.round((thursday.getTime() - firstMonday.getTime() - 3 * 86_400_000) / (7 * 86_400_000));
  return `${year}-W${String(week).padStart(2, "0")}`;
}

// La tarjeta aparece sola los lunes, hasta que se descarta esa semana (se guarda en las preferencias).
export function isWeekDue(now: number, dismissed?: string): boolean {
  return new Date(now).getDay() === 1 && dismissed !== weekKey(now);
}

// Tiempo medio de respuesta en texto corto: "40 s", "12 min", "1 h 5 min", "1 d 6 h".
export function durationText(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const min = Math.round(s / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return min % 60 ? `${h} h ${min % 60} min` : `${h} h`;
  return h % 24 ? `${Math.floor(h / 24)} d ${h % 24} h` : `${Math.floor(h / 24)} d`;
}
