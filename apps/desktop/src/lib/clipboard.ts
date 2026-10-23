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
