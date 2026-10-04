import { getAccess, can } from "@/lib/access";
import { getSettings } from "@/lib/settings";
import { clientVisitBrief } from "@/lib/crm/intelligence";

export const dynamic = "force-dynamic";

/** Fiche pré-visite d'un client (Ma tournée), chargée à la demande au démarrage d'une visite. */
export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const access = await getAccess();
  if (!access) return Response.json({ error: "Session expirée." }, { status: 401 });
  if (!can(access.perms, "clients", "view")) return Response.json({ error: "Accès refusé." }, { status: 403 });
  const { id } = await props.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "Client inconnu." }, { status: 404 });
  if (access.scope !== "ALL" && !access.clientIds.includes(id)) return Response.json({ error: "Client hors de votre portée." }, { status: 403 });
  const brief = await clientVisitBrief(id, await getSettings());
  if (!brief) return Response.json({ error: "Client introuvable." }, { status: 404 });
  // Encours et échu : réservés à qui voit les règlements ou les factures.
  const money = can(access.perms, "reglements", "view") || can(access.perms, "facturation", "view");
  return Response.json(money ? brief : { ...brief, receivables: null }, { headers: { "Cache-Control": "no-store" } });
}
