// La ventana principal publica el estado; la ventana mascota solo lo pinta.
export const MASCOT_EVENT = "devi://mascota";
// La mascota lo emite al abrirse para pedir el estado actual.
export const MASCOT_READY = "devi://mascota-lista";

export type MascotState = { online: boolean; pending: number; label: string; pokeKey: number };
