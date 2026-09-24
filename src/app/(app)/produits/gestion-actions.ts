"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { products } from "@/db/schema";
import { requirePermission } from "@/lib/access";
import { audit, changedFields } from "@/lib/audit";
import { bool, errorParam, intOrNull, isUuid, str } from "@/lib/gestion/form";

/**
 * Données commerciales d'un article : référence COMANET, EAN, nature, TVA, unité, colisage,
 * suivi des lots. Garde-fous : un article qui a déjà du stock sans lot ne passe pas en suivi par
 * lot, et un article stocké ne devient pas un service.
 */
export async function saveProductTradeAction(fd: FormData) {
  const user = await requirePermission("produits", "edit");
  const id = str(fd, "id");
  if (!isUuid(id)) return;
  try {
    const code = str(fd, "code")?.toUpperCase() ?? null;
    const ean = str(fd, "ean")?.replace(/\s/g, "") ?? null;
    if (ean && !/^\d{8}$|^\d{12,14}$/.test(ean)) throw new Error("EAN : 8, 12, 13 ou 14 chiffres attendus.");
    const kind = str(fd, "kind") === "SERVICE" ? "SERVICE" : "PRODUIT";
    const next = {
      code, ean, kind,
      taxRateKey: str(fd, "taxRateKey"),
      unit: str(fd, "unit") ?? "unité",
      packSize: intOrNull(fd, "packSize", "Colisage", 1, 100000),
      trackLots: bool(fd, "trackLots"),
    };
    await db.transaction(async (tx) => {
      const [before] = await tx.select().from(products).where(eq(products.id, id)).for("update");
      if (!before) throw new Error("Article introuvable.");
      const moves = (await tx.execute<{ total: number; without_lot: number }>(sql`
        select count(*)::int as total, count(*) filter (where lot_id is null)::int as without_lot from stock_movements where product_id = ${id}::uuid`)).rows[0];
      if (next.kind === "SERVICE" && moves.total > 0) throw new Error("Cet article a des mouvements de stock : il ne peut pas devenir un service.");
      if (next.trackLots && !before.trackLots && moves.without_lot > 0) throw new Error(`Suivi par lot impossible : ${moves.without_lot} mouvement(s) de stock existent sans lot. Activez le suivi par lot avant de charger le stock initial.`);
      if (code) {
        const clash = (await tx.execute<{ name: string }>(sql`select name from products where code = ${code} and id <> ${id}::uuid`)).rows[0];
        if (clash) throw new Error(`La référence ${code} est déjà portée par « ${clash.name} ».`);
      }
      if (ean) {
        const clash = (await tx.execute<{ name: string }>(sql`select name from products where ean = ${ean} and id <> ${id}::uuid`)).rows[0];
        if (clash) throw new Error(`L'EAN ${ean} est déjà porté par « ${clash.name} ».`);
      }
      const diff = changedFields(before as unknown as Record<string, unknown>, next);
      if (!diff) return;
      await tx.update(products).set(next).where(eq(products.id, id));
      await audit({ actor: { id: user.id, name: user.name }, action: "UPDATE", module: "produits", entity: "product", entityId: id, label: before.name, before: diff.before, after: diff.after }, tx);
    });
  } catch (e) {
    redirect(`/produits/${id}?error=${errorParam(e)}#gestion`);
  }
  revalidatePath(`/produits/${id}`);
  revalidatePath("/gestion");
  redirect(`/produits/${id}?done=gestion#gestion`);
}
