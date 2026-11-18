import { revalidatePath } from "next/cache";
import { getAccess } from "@/lib/access";
import { getSettings } from "@/lib/settings";
import { activationRefs } from "@/lib/activations/refs";
import { activationScope, canDoActivation } from "@/lib/activations/access";
import { getActivation } from "@/lib/activations/queries";
import { storeAsset } from "@/lib/content/assets";

export const dynamic = "force-dynamic";

/** Photo d'un compte rendu : réduite sur le téléphone (≈ 1600 px, JPEG) avant l'envoi, rangée dans `content_assets`. */
const MAX = 4 * 1024 * 1024;

export async function POST(req: Request) {
  const access = await getAccess();
  if (!access) return Response.json({ error: "Session expirée : reconnectez-vous." }, { status: 401 });
  if (access.preview || !(await canDoActivation("create"))) return Response.json({ error: "Accès refusé." }, { status: 403 });
  const fd = await req.formData().catch(() => null);
  const id = String(fd?.get("id") ?? "");
  const file = fd?.get("file");
  if (!/^[0-9a-f-]{36}$/i.test(id) || !(file instanceof Blob)) return Response.json({ error: "Photo illisible." }, { status: 400 });
  if (!file.type.startsWith("image/")) return Response.json({ error: "Seules les photos sont acceptées." }, { status: 415 });
  if (file.size > MAX) return Response.json({ error: "Photo trop lourde (4 Mo au plus)." }, { status: 413 });
  const [refs, settings, scope] = await Promise.all([activationRefs(), getSettings(), activationScope()]);
  if (!(await getActivation(id, scope, refs, settings.activations))) return Response.json({ error: "Opération introuvable ou hors de votre périmètre." }, { status: 404 });
  const name = (file as File).name || `photo-${Date.now()}.jpg`;
  await storeAsset({ owner: { activationId: id }, kind: "PHOTO", name, mime: file.type, data: Buffer.from(await file.arrayBuffer()), uploadedById: access.user.id });
  revalidatePath(`/marketing/activations/${id}`);
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
