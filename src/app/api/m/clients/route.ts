import { getAccess, can } from "@/lib/access";
import { normKey } from "@/lib/import/normalize";
import { pointsOfSale } from "@/lib/terrain/points-of-sale";
import { personaOf } from "@/lib/mobile/persona";

export const dynamic = "force-dynamic";

/** Recherche en ligne d'un point de vente hors de ceux gardés sur le téléphone. Rien de ces résultats n'est stocké. */
export async function GET(req: Request) {
  const access = await getAccess();
  if (!access) return Response.json({ error: "Session expirée : reconnectez-vous." }, { status: 401 });
  if (!can(access.perms, "terrain", "view") && !can(access.perms, "clients", "view")) return Response.json({ error: "Accès refusé." }, { status: 403 });
  // L'animatrice peut saisir chez tout point de vente ; le commercial ne cherche que dans sa portée.
  const inScope = (id: string) => access.scope === "ALL" || personaOf(access.perms, access.scope) === "ANIMATRICE" || access.clientIds.includes(id);
  const q = normKey(new URL(req.url).searchParams.get("q") ?? "");
  if (q.length < 2) return Response.json({ clients: [] });
  const all = await pointsOfSale();
  const clients = all.filter((c) => inScope(c.id) && (normKey(c.name).includes(q) || normKey(c.city ?? "").includes(q))).slice(0, 30);
  return Response.json({ clients }, { headers: { "Cache-Control": "no-store" } });
}
