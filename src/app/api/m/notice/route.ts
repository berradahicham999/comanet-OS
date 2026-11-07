import { getAccess } from "@/lib/access";
import { acceptTerrainNotice } from "@/lib/mobile/snapshot";

export const dynamic = "force-dynamic";

/** Prise de connaissance de l'information GPS de la saisie terrain (horodatée, conservée). */
export async function POST(req: Request) {
  const access = await getAccess();
  if (!access) return Response.json({ error: "Session expirée : reconnectez-vous." }, { status: 401 });
  if (access.preview) return Response.json({ error: "Prévisualisation : lecture seule." }, { status: 403 });
  await acceptTerrainNotice(access.user.id, req.headers.get("user-agent"));
  return Response.json({ ok: true });
}
