import { getAccess, can } from "@/lib/access";
import { lastReadingsForClient } from "@/lib/client-stock";

export const dynamic = "force-dynamic";

/**
 * Dernier relevé de stock par produit chez un client — pour pré-remplir le champ « rayon »
 * de la saisie terrain quand l'animatrice choisit son point de vente. Lecture seule ;
 * ouvert à qui voit Terrain ou Clients.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ clientId: string }> }) {
  const access = await getAccess();
  if (!access || !(can(access.perms, "terrain", "view") || can(access.perms, "clients", "view"))) {
    return Response.json({ error: "Accès refusé" }, { status: 403 });
  }
  const { clientId } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(clientId)) return Response.json({}, { status: 400 });
  return Response.json(await lastReadingsForClient(clientId), { headers: { "Cache-Control": "no-store" } });
}
