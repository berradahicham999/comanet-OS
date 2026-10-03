import { getAccess, can } from "@/lib/access";
import { db } from "@/db";
import { doctorAllowed } from "@/lib/medical/chrono";
import { doctorBrief } from "@/lib/medical/prescriptions";

export const dynamic = "force-dynamic";

/** Fiche pré-visite d'un médecin (lecture seule). Une déléguée ne lit que les médecins de ses secteurs. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const access = await getAccess();
  if (!access || !can(access.perms, "medical", "view")) return Response.json({ error: "Accès refusé" }, { status: 403 });
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "Identifiant invalide" }, { status: 400 });
  if (!(await doctorAllowed(db, id, access.user.id, access.scope === "OWN"))) return Response.json({ error: "Médecin hors de vos secteurs" }, { status: 403 });
  const brief = await doctorBrief(id);
  if (!brief) return Response.json({ error: "Médecin introuvable" }, { status: 404 });
  return Response.json(brief, { headers: { "Cache-Control": "no-store" } });
}
