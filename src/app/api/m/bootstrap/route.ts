import { getAccess } from "@/lib/access";
import { mobileSnapshot } from "@/lib/mobile/snapshot";

export const dynamic = "force-dynamic";

/**
 * Tout ce que le téléphone garde pour travailler sans réseau, filtré par les droits côté serveur.
 * Un 401 dit à l'app d'effacer ses référentiels : session expirée, ou appareil révoqué par un administrateur.
 */
export async function GET() {
  const access = await getAccess();
  if (!access) return Response.json({ error: "Session expirée : reconnectez-vous." }, { status: 401 });
  return Response.json(await mobileSnapshot(access), { headers: { "Cache-Control": "no-store" } });
}
