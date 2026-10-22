// Tema: sigue al sistema (prefers-color-scheme) salvo que se elija Claro u Oscuro en Ajustes.
// La preferencia vive en las prefs de config.json; se copia en localStorage para que la ventana
// de la mascota (mismo origen) y el primer pintado la tengan sin esperar a Rust.
export type ThemePref = "system" | "light" | "dark";
export const THEME_KEY = "devi.theme";

export const THEME_OPTIONS: { value: ThemePref; label: string }[] = [
  { value: "system", label: "Sistema" },
  { value: "light", label: "Claro" },
  { value: "dark", label: "Oscuro" },
];

export function isThemePref(x: unknown): x is ThemePref {
  return x === "system" || x === "light" || x === "dark";
}

export function applyTheme(pref: ThemePref | undefined, root: HTMLElement = document.documentElement): void {
  const p = pref ?? "system";
  if (p === "system") delete root.dataset.theme;
  else root.dataset.theme = p;
  try {
    localStorage.setItem(THEME_KEY, p);
  } catch {
    // sin almacenamiento local: solo se pierde la copia para la mascota
  }
}

export function storedTheme(): ThemePref {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return isThemePref(v) ? v : "system";
  } catch {
    return "system";
  }
}

// Ventana de la mascota: aplica la copia guardada y la sigue cuando la principal la cambia.
export function followStoredTheme(): () => void {
  applyTheme(storedTheme());
  const on = (e: StorageEvent) => {
    if (e.key === THEME_KEY) applyTheme(isThemePref(e.newValue) ? e.newValue : "system");
  };
  window.addEventListener("storage", on);
  return () => window.removeEventListener("storage", on);
}
