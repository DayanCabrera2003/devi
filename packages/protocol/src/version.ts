// Versión del protocolo. Cliente y servidor son compatibles si comparten la versión mayor.
export const API_VERSION = "1.0.0";
export const VERSION_HEADER = "X-Devi-Version";
// EventSource no admite cabeceras: en los SSE la versión va en ?v=
export const VERSION_QUERY = "v";

const major = (v: string) => {
  const m = /^(\d+)\.\d+\.\d+$/.exec(v);
  return m ? Number(m[1]) : null;
};

export function isCompatible(clientVersion: string | null | undefined): boolean {
  if (!clientVersion) return false;
  const c = major(clientVersion);
  return c !== null && c === major(API_VERSION);
}
