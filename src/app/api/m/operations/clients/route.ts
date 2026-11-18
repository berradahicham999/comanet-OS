import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getAccess } from "@/lib/access";
import { normKey } from "@/lib/import/normalize";
import { canDoActivation } from "@/lib/activations/access";

export const dynamic = "force-dynamic";

/**
 * Recherche du client d'une opération : tout client actif, grossistes compris. La saisie des ventes, elle, garde sa règle
 * (`pointsOfSale()` : un grossiste n'y apparaît qu'assigné ou déjà animé) ; une opération chez un grossiste est justement
 * le cas d'usage de Sara et des animatrices. Rien n'est stocké sur le téléphone.
 */
export async function GET(req: Request) {
  const access = await getAccess();
  if (!access) return Response.json({ error: "Session expirée : reconnectez-vous." }, { status: 401 });
  if (!(await canDoActivation("create"))) return Response.json({ error: "Accès refusé." }, { status: 403 });
  const q = normKey(new URL(req.url).searchParams.get("q") ?? "");
  if (q.length < 2) return Response.json({ clients: [] });
  const rows = await db.execute<{ id: string; name: string; city: string | null; type: string }>(sql`select id::text, name, city, type from clients where active order by (type = 'GROSSISTE') desc, name`);
  const clients = rows.rows.filter((c) => normKey(c.name).includes(q) || normKey(c.city ?? "").includes(q)).slice(0, 30)
    .map((c) => ({ id: c.id, name: c.type === "GROSSISTE" ? `${c.name} (grossiste)` : c.name, city: c.city, mine: false }));
  return Response.json({ clients }, { headers: { "Cache-Control": "no-store" } });
}
