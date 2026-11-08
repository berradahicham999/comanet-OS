import { revalidatePath } from "next/cache";
import { getAccess } from "@/lib/access";
import { isUuid } from "@/lib/mobile/mutations-shared";
import { decideValidation, listValidations } from "@/lib/mobile/validations";
import type { ValidationDecision } from "@/lib/mobile/validations-shared";

export const dynamic = "force-dynamic";

/** File unique de validation : la liste (GET) et une décision (POST). Chaque décision repasse par le contrôle de droits de sa file. */
export async function GET() {
  const access = await getAccess();
  if (!access) return Response.json({ error: "Session expirée : reconnectez-vous." }, { status: 401 });
  return Response.json({ items: await listValidations(access) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const access = await getAccess();
  if (!access) return Response.json({ error: "Session expirée : reconnectez-vous." }, { status: 401 });
  if (access.preview) return Response.json({ error: "Prévisualisation : lecture seule." }, { status: 403 });
  const d = (await req.json().catch(() => null)) as ValidationDecision | null;
  if (!d || !isUuid(d.id) || (d.decision !== "OK" && d.decision !== "KO")) return Response.json({ ok: false, error: "Décision illisible." }, { status: 400 });
  const r = await decideValidation(access, d);
  for (const path of ["/marketing/planning", "/marketing/activations", "/gestion/pieces", "/"]) revalidatePath(path);
  return Response.json(r, { status: r.ok ? 200 : 422 });
}
