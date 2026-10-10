import type { Member } from "../shared/types";

// Carga team.json (lo edita el administrador de Devi) y valida su forma.
export async function loadTeam(path: string): Promise<Member[]> {
  const raw = await Bun.file(path).json();
  if (!Array.isArray(raw)) throw new Error(`${path} debe ser un array de miembros`);
  return raw.map((m, i) => {
    for (const key of ["id", "name", "role", "description"] as const) {
      if (typeof m?.[key] !== "string" || !m[key]) {
        throw new Error(`${path}[${i}] le falta "${key}"`);
      }
    }
    return { id: m.id, name: m.name, role: m.role, description: m.description };
  });
}
