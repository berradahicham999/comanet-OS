import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getSettings } from "@/lib/settings";

/**
 * Données de la saisie d'une pièce d'achat : fournisseurs actifs (devise, marques), articles avec
 * TVA et suivi des lots, matériel marketing, dépôts internes, et dernier prix payé par article,
 * fournisseur et devise (proposé par défaut, jamais converti d'une devise à l'autre).
 */
export async function purchaseEditorData() {
  const g = (await getSettings()).gestion;
  const [suppliers, products, items, warehouses, lastPrices, defaultRate] = await Promise.all([
    db.execute<{ id: string; legal_name: string; currency: string; nature: string; brand_ids: string[] | null }>(sql`
      select s.id, s.legal_name, s.currency, s.nature, array_agg(sb.brand_id) filter (where sb.brand_id is not null) as brand_ids
      from suppliers s left join supplier_brands sb on sb.supplier_id = s.id where s.active group by s.id order by s.legal_name`),
    db.execute<{ id: string; name: string; ref: string | null; ean: string | null; kind: string; brand_id: string | null; brand: string | null; rate: string | null; track_lots: boolean }>(sql`
      select p.id, p.name, coalesce(p.code, p.sku) as ref, p.ean, p.kind, p.brand_id, b.name as brand, tr.rate::text as rate, p.track_lots
      from products p left join brands b on b.id = p.brand_id left join tax_rates tr on tr.key = p.tax_rate_key where p.active order by b.name nulls last, p.name`),
    db.execute<{ id: string; name: string; sku: string | null; brand_id: string | null; unit_cost: string }>(sql`
      select id, name, sku, brand_id, unit_cost::text from inventory_items where active order by name`),
    db.execute<{ key: string; label: string }>(sql`select key, label from warehouses where active and kind = 'INTERNE' order by sort, key`),
    db.execute<{ k: string; price: string }>(sql`
      select distinct on (d.supplier_id, d.currency, coalesce(l.product_id, l.inventory_item_id))
        d.supplier_id || '|' || d.currency || '|' || coalesce(l.product_id, l.inventory_item_id) as k, l.unit_price::text as price
      from purchase_document_lines l join purchase_documents d on d.id = l.document_id
      where d.status <> 'BROUILLON' and coalesce(l.product_id, l.inventory_item_id) is not null
      order by d.supplier_id, d.currency, coalesce(l.product_id, l.inventory_item_id), d.date desc, d.created_at desc`),
    db.execute<{ rate: string }>(sql`select rate::text as rate from tax_rates where key = ${g.defaultTaxRateKey}`),
  ]);
  const rate = defaultRate.rows[0]?.rate ?? "20.00";
  return {
    suppliers: suppliers.rows.map((s) => ({ id: s.id, name: s.legal_name, currency: s.currency, nature: s.nature, brandIds: s.brand_ids ?? [] })),
    products: products.rows.map((p) => ({ id: p.id, name: p.name, ref: p.ref, ean: p.ean, kind: p.kind, brandId: p.brand_id, brand: p.brand, taxRate: p.rate ?? rate, trackLots: p.track_lots })),
    items: items.rows.map((i) => ({ id: i.id, name: i.name, sku: i.sku, brandId: i.brand_id, unitCost: i.unit_cost })),
    warehouses: warehouses.rows,
    lastPrices: Object.fromEntries(lastPrices.rows.map((r) => [r.k, r.price])) as Record<string, string>,
    defaultRate: rate,
  };
}
export type PurchaseEditorData = Awaited<ReturnType<typeof purchaseEditorData>>;
