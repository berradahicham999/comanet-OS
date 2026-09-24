import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireAccessContext, can } from "@/lib/access";
import { readAsset } from "@/lib/content/assets";

/** Fichier du fournisseur rattaché à une pièce d'achat (facture reçue, BL scanné). */
export async function GET(_req: Request, ctx: { params: Promise<{ assetId: string }> }) {
  const a = await requireAccessContext();
  const { assetId } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(assetId)) return new Response("Introuvable", { status: 404 });
  const owner = (await db.execute<{ type: string }>(sql`
    select d.type from content_assets f join purchase_documents d on d.id = f.purchase_document_id where f.id = ${assetId}::uuid`)).rows[0];
  if (!owner) return new Response("Introuvable", { status: 404 });
  const ok = can(a.perms, "achats", "view") || ((owner.type === "RECEPTION" || owner.type === "RETOUR") && can(a.perms, "stock", "view"));
  if (!ok) return new Response("Accès refusé", { status: 403 });
  const f = await readAsset(assetId);
  if (!f) return new Response("Introuvable", { status: 404 });
  return new Response(new Uint8Array(f.data), { headers: { "Content-Type": f.mime, "Content-Disposition": `inline; filename="${encodeURIComponent(f.name)}"`, "Cache-Control": "private, no-store" } });
}
