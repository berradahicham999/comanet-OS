import { getAccess, can, clientInScope } from "@/lib/access";
import { clientReturnContext } from "@/lib/gestion/client-returns";

export const dynamic = "force-dynamic";

/**
 * Avoir libre : dernier prix de chaque produit pour ce client et lots qui lui ont été livrés, chargés dès que le
 * client est choisi. Lecture seule ; droit « Voir » sur Facturation et client dans la portée.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ clientId: string }> }) {
  const access = await getAccess();
  if (!access || !can(access.perms, "facturation", "view")) return Response.json({ error: "Accès refusé" }, { status: 403 });
  const { clientId } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(clientId)) return Response.json({ lastPrices: {}, lots: {} }, { status: 400 });
  if (!(await clientInScope(clientId))) return Response.json({ error: "Accès refusé" }, { status: 403 });
  return Response.json(await clientReturnContext(clientId), { headers: { "Cache-Control": "no-store" } });
}
