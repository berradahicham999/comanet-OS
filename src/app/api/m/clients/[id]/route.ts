import { getAccess, can } from "@/lib/access";
import { isUuid } from "@/lib/mobile/mutations-shared";
import { clientSheet } from "@/lib/mobile/snapshot";

export const dynamic = "force-dynamic";

/** Fiche courte d'un client, gardée sur le téléphone. Portée et droits vérifiés ici, côté serveur. */
export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const access = await getAccess();
  if (!access) return Response.json({ error: "Session expirée : reconnectez-vous." }, { status: 401 });
  if (!can(access.perms, "clients", "view")) return Response.json({ error: "Accès refusé." }, { status: 403 });
  const { id } = await props.params;
  if (!isUuid(id)) return Response.json({ error: "Client inconnu." }, { status: 404 });
  const sheet = await clientSheet(access, id);
  if (!sheet) return Response.json({ error: "Client hors de votre portée." }, { status: 403 });
  return Response.json(sheet, { headers: { "Cache-Control": "no-store" } });
}
