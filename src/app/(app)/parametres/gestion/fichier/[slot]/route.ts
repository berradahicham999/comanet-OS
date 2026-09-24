import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireAccess } from "@/lib/access";
import { readAsset, COMPANY_SLOTS, type CompanySlot } from "@/lib/content/assets";

/**
 * Logo ou cachet de la société (dernière version), pour l'aperçu des paramètres. Réservé à
 * l'administration : le cachet signé ne doit pas circuler hors des pièces émises.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ slot: string }> }) {
  await requireAccess("administration");
  const { slot } = await ctx.params;
  if (!COMPANY_SLOTS.includes(slot as CompanySlot)) return new Response("Introuvable", { status: 404 });
  const id = (await db.execute<{ id: string }>(sql`select id from content_assets where company_slot = ${slot} order by version desc, created_at desc limit 1`)).rows[0]?.id;
  const file = id ? await readAsset(id) : null;
  if (!file) return new Response("Aucun fichier", { status: 404 });
  return new Response(new Uint8Array(file.data), { headers: { "Content-Type": file.mime, "Cache-Control": "private, no-store" } });
}
