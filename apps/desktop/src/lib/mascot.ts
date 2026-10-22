// La ventana principal publica el estado; la ventana mascota solo lo pinta.
export const MASCOT_EVENT = "devi://mascota";
// La mascota lo emite al abrirse para pedir el estado actual.
export const MASCOT_READY = "devi://mascota-lista";

export type MascotState = { online: boolean; pending: number; label: string; pokeKey: number };

// Etiqueta de la ventana mascota (la crea Rust bajo demanda, ver src-tauri/src/windows.rs).
export const MASCOT_LABEL = "mascota";

// La ventana mascota es transparente: html y body no pintan fondo (ver body.mascota en styles.css).
// Se marca antes del primer pintado para que nunca se vea el fondo de la app.
export function markMascotDocument(doc: Document): void {
  doc.documentElement.classList.add("mascota");
  doc.body.classList.add("mascota");
}
