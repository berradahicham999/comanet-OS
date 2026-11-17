import { revalidatePath } from "next/cache";
import { getAccess } from "@/lib/access";
import { decideValidation, listValidations, VALIDATION_PATHS } from "@/lib/validations/queue";
import { readDecision } from "@/lib/validations/shared";

export const dynamic = "force-dynamic";

/**
 * File unique « À décider » pour le téléphone : la liste (GET) et une décision (POST). Mêmes fonctions que le Cockpit
 * (`src/lib/validations/`) ; chaque décision repasse par le contrôle de droits de sa file.
 */
export async function GET() {
  const access = await getAccess();
  if (!access) return Response.json({ error: "Session expirée : reconnectez-vous." }, { status: 401 });
  return Response.json({ items: await listValidations(access) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const access = await getAccess();
  if (!access) return Response.json({ error: "Session expirée : reconnectez-vous." }, { status: 401 });
  if (access.preview) return Response.json({ error: "Prévisualisation : lecture seule." }, { status: 403 });
  const d = readDecision(await req.json().catch(() => null));
  if (!d) return Response.json({ ok: false, error: "Décision illisible." }, { status: 400 });
  const r = await decideValidation(access, d);
  for (const path of VALIDATION_PATHS) revalidatePath(path);
  return Response.json(r, { status: r.ok ? 200 : 422 });
}
