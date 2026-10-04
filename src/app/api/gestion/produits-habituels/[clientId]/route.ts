import { getAccess, can, clientInScope } from "@/lib/access";
import { usualProductsForClient } from "@/lib/gestion/usual-products";

export const dynamic = "force-dynamic";

/**
 * Produits habituels d'un client — pour la saisie d'une commande ou d'un BL sur le téléphone :
 * dès que le commercial choisit le client, ses produits les plus commandés s'ajoutent en un geste.
 * Lecture seule ; droit « Voir » sur Livraisons et client dans la portée.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ clientId: string }> }) {
  const access = await getAccess();
  if (!access || !can(access.perms, "livraisons", "view")) return Response.json({ error: "Accès refusé" }, { status: 403 });
  const { clientId } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(clientId)) return Response.json([], { status: 400 });
  if (!(await clientInScope(clientId))) return Response.json({ error: "Accès refusé" }, { status: 403 });
  return Response.json(await usualProductsForClient(clientId), { headers: { "Cache-Control": "no-store" } });
}
