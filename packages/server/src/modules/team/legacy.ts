import { z } from "zod";
import type { LegacyMember } from "./service";

// team.json del proof of concept: [{ id, name, role, description }], sin login.
const LegacyTeamSchema = z.array(
  z.object({ id: z.string().min(1), name: z.string().min(1), role: z.string().min(1), description: z.string() }),
);

export async function readLegacyTeam(path: string): Promise<LegacyMember[]> {
  const file = Bun.file(path);
  if (!(await file.exists())) throw new Error(`No existe ${path}`);
  const parsed = LegacyTeamSchema.safeParse(await file.json());
  if (!parsed.success) throw new Error(`${path} no tiene la forma de team.json: ${parsed.error.issues[0]?.message}`);
  return parsed.data;
}
