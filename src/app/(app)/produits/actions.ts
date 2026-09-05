"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { products, productAliases, stockSnapshots } from "@/db/schema";
import { requireAccess } from "@/lib/access";
import { normKey } from "@/lib/import/normalize";

const numOrNull = (v: FormDataEntryValue | null) => { const s = String(v ?? "").replace(",", ".").trim(); return s === "" ? null : Number(s); };
const money = (v: FormDataEntryValue | null) => { const n = numOrNull(v); return n === null || Number.isNaN(n) ? null : n.toFixed(2); };

export async function saveProduct(formData: FormData) {
  await requireAccess("produits");
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const values = {
    name, nameKey: normKey(name),
    sku: String(formData.get("sku") ?? "").trim() || null,
    shortName: String(formData.get("shortName") ?? "").trim() || null,
    brandId: String(formData.get("brandId") ?? "") || null,
    category: String(formData.get("category") ?? "").trim() || null,
    priceRetail: money(formData.get("priceRetail")),
    priceWholesale: money(formData.get("priceWholesale")),
    costPrice: money(formData.get("costPrice")),
    leadTimeDays: Math.round(numOrNull(formData.get("leadTimeDays")) ?? 60),
    safetyStockDays: Math.round(numOrNull(formData.get("safetyStockDays")) ?? 30),
    moq: numOrNull(formData.get("moq")) ? Math.round(numOrNull(formData.get("moq"))!) : null,
    active: formData.get("active") === "on",
    needsReview: false,
    benefits: String(formData.get("benefits") ?? "").trim() || null,
    claims: String(formData.get("claims") ?? "").trim() || null,
    actives: String(formData.get("actives") ?? "").trim() || null,
    target: String(formData.get("target") ?? "").trim() || null,
    marketingAngle: String(formData.get("marketingAngle") ?? "").trim() || null,
    imageUrl: String(formData.get("imageUrl") ?? "").trim() || null,
  };
  if (id) {
    await db.update(products).set(values).where(eq(products.id, id));
    revalidatePath(`/produits/${id}`);
    revalidatePath("/produits");
  } else {
    const [row] = await db.insert(products).values(values).returning();
    revalidatePath("/produits");
    redirect(`/produits/${row.id}`);
  }
}

/** Fusionne le produit source dans le produit cible : ventes, stock, alias, réglementaire, contenus, objectifs. */
export async function mergeProduct(formData: FormData) {
  await requireAccess("produits");
  const sourceId = String(formData.get("sourceId") ?? "");
  const targetId = String(formData.get("targetId") ?? "");
  if (!sourceId || !targetId || sourceId === targetId) return;
  const source = await db.query.products.findFirst({ where: eq(products.id, sourceId) });
  if (!source) return;
  await db.transaction(async (tx) => {
    await tx.execute(sql`update sales set product_id = ${targetId}::uuid where product_id = ${sourceId}::uuid`);
    await tx.execute(sql`update stock_snapshots set product_id = ${targetId}::uuid where product_id = ${sourceId}::uuid`);
    await tx.execute(sql`update animation_lines set product_id = ${targetId}::uuid where product_id = ${sourceId}::uuid`);
    await tx.execute(sql`update regulatory_files set product_id = ${targetId}::uuid where product_id = ${sourceId}::uuid`);
    await tx.execute(sql`update content_items set product_id = ${targetId}::uuid where product_id = ${sourceId}::uuid`);
    await tx.execute(sql`delete from objectives where product_id = ${sourceId}::uuid and exists (select 1 from objectives o2 where o2.product_id = ${targetId}::uuid and o2.year = objectives.year and coalesce(o2.month,0) = coalesce(objectives.month,0))`);
    await tx.execute(sql`update objectives set product_id = ${targetId}::uuid where product_id = ${sourceId}::uuid`);
    await tx.execute(sql`update product_aliases set product_id = ${targetId}::uuid where product_id = ${sourceId}::uuid`);
    await tx.insert(productAliases).values({ alias: source.nameKey, productId: targetId, source: "MERGE" }).onConflictDoNothing();
    if (source.sku) {
      const target = await tx.query.products.findFirst({ where: eq(products.id, targetId) });
      if (target && !target.sku) { await tx.delete(products).where(eq(products.id, sourceId)); await tx.update(products).set({ sku: source.sku }).where(eq(products.id, targetId)); return; }
    }
    await tx.delete(products).where(eq(products.id, sourceId));
  });
  revalidatePath("/produits");
  redirect(`/produits/${targetId}`);
}

export async function addStockSnapshot(formData: FormData) {
  await requireAccess("stock");
  const productId = String(formData.get("productId") ?? "");
  const quantity = numOrNull(formData.get("quantity"));
  if (!productId || quantity === null) return;
  const onOrder = numOrNull(formData.get("onOrder")) ?? 0;
  const date = String(formData.get("date") ?? "") || new Date().toISOString().slice(0, 10);
  await db.insert(stockSnapshots).values({ productId, quantity: String(quantity), onOrder: String(onOrder), date, source: "MANUAL" });
  revalidatePath(`/produits/${productId}`);
  revalidatePath("/stock");
}
