// Traspaso de sesión: el comando que empieza una sesión de Claude Code con el traspaso de un compañero.
// El id viene del servidor; aun así solo se aceptan los caracteres de un request_id (es texto que se pega en una terminal).
const REQUEST_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function handoffCommand(requestId: string): string {
  if (!REQUEST_ID.test(requestId)) throw new Error(`id de traspaso inválido: ${requestId}`);
  return `devi claude --handoff ${requestId}`;
}

// Portapapeles del webview (sin permisos de Rust). Devuelve false si no se pudo: la UI enseña el texto para copiarlo a mano.
export async function copyText(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
