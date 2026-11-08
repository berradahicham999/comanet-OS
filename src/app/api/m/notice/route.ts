import { getAccess } from "@/lib/access";
import { acceptTerrainNotice } from "@/lib/mobile/snapshot";
import { acceptGpsNotice } from "@/lib/medical/chrono";

export const dynamic = "force-dynamic";

/** Prise de connaissance de l'information GPS de la saisie terrain (horodatée, conservée). */
export async function POST(req: Request) {
  const access = await getAccess();
  if (!access) return Response.json({ error: "Session expirée : reconnectez-vous." }, { status: 401 });
  if (access.preview) return Response.json({ error: "Prévisualisation : lecture seule." }, { status: 403 });
  const kind = ((await req.json().catch(() => null)) as { kind?: string } | null)?.kind;
  const ua = req.headers.get("user-agent");
  if (kind === "MEDICAL") await acceptGpsNotice(access.user.id, ua);
  else await acceptTerrainNotice(access.user.id, ua);
  return Response.json({ ok: true });
}
